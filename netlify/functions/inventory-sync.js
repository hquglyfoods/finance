// netlify/functions/inventory-sync.js
// Daily sync from the Inventory app's Supabase (single source of truth for
// QuickBooks invoices, Ummas store orders, and Wix). Finance Tool reads it
// read-only with a dedicated secret key and writes into its own tables.
//
// Mapping:
//   source 'quickbooks' + customer American Dream/Bushwick/Forest Hills
//       -> HQ revenue (ingredients channel) AND that store's HQ Supplies expense
//   source 'quickbooks' + customer Pearland (franchisee)
//       -> HQ revenue only, no store expense
//   source 'ummasrecipe-store' or 'wix'
//       -> UMMA revenue (ugly / franchise / other_rev channel)
//
// Looks back 10 days so late/edited orders are captured. Manual overrides
// (source 'manual' on a Finance Tool row) are never touched.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY               (Finance Tool's own project)
//   INV_SUPABASE_URL, INV_SUPABASE_READ_KEY          (Inventory app, read-only)
// Optional:
//   INV_CUSTOMER_MAP  "american dream=AD;bushwick=BW;forest hills=FH;pearland=PEARLAND"
//   INV_UMMA_MAP      "ummasrecipe-store=ugly;wix=franchise"  (source -> UMMA channel)

const { createClient } = require('@supabase/supabase-js');
const pad = n => String(n).padStart(2, '0');

const DEFAULT_CUSTOMER_MAP = [
  { match: 'american dream', store: 'AD' },
  { match: 'bushwick', store: 'BW' },
  { match: 'forest hills', store: 'FH' },
  { match: 'pearland', store: 'PEARLAND' },
];
const DEFAULT_UMMA_MAP = { 'ummasrecipe-store': 'ugly', 'wix': 'franchise' };

function parseCustomerMap(s) {
  if (!s) return null;
  return s.split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const [match, store] = x.split('='); return { match: match.toLowerCase().trim(), store: store.trim() };
  });
}
function parseUmmaMap(s) {
  if (!s) return null;
  const o = {}; s.split(';').map(x => x.trim()).filter(Boolean).forEach(x => {
    const [src, ch] = x.split('='); o[src.trim()] = ch.trim();
  });
  return o;
}
function storeFor(rules, name) {
  const c = (name || '').toLowerCase();
  for (const r of rules) if (c.includes(r.match)) return r.store;
  return null;
}

exports.handler = async (event) => {
  const fin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });
  const inv = createClient(process.env.INV_SUPABASE_URL, process.env.INV_SUPABASE_READ_KEY,
    { auth: { persistSession: false } });

  const custRules = parseCustomerMap(process.env.INV_CUSTOMER_MAP) || DEFAULT_CUSTOMER_MAP;
  const ummaMap = parseUmmaMap(process.env.INV_UMMA_MAP) || DEFAULT_UMMA_MAP;

  // date window: default is today back through 10 days ago (INCLUDING today, so an
  // order placed today syncs immediately), or an explicit range via ?from=&to=
  // (use the range to backfill months of history, e.g. UMMA orders).
  const qs = (event && event.queryStringParameters) || {};
  let dMin, dMax;
  if (qs.from && qs.to) {
    dMin = qs.from; dMax = qs.to;
  } else {
    const today = new Date();
    const back10 = new Date(); back10.setDate(back10.getDate() - 10);
    dMax = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    dMin = `${back10.getFullYear()}-${pad(back10.getMonth() + 1)}-${pad(back10.getDate())}`;
  }
  // enumerate every date from dMin..dMax (inclusive) for the write loop
  const dates = [];
  {
    const cur = new Date(dMin + 'T00:00:00Z');
    const end = new Date(dMax + 'T00:00:00Z');
    while (cur <= end) {
      dates.push(`${cur.getUTCFullYear()}-${pad(cur.getUTCMonth() + 1)}-${pad(cur.getUTCDate())}`);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  // pull inventory orders in window, join customer name (paginated: a wide
  // backfill range can exceed the 1000-row cap)
  let orders = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await inv
        .from('orders')
        .select('source, order_date, total_amount, customer_id, customers(name)')
        .gte('order_date', dMin).lte('order_date', dMax)
        .in('source', ['quickbooks', 'ummasrecipe-store', 'wix'])
        .order('order_date').range(from, from + PAGE - 1);
      if (error) return { statusCode: 500, body: JSON.stringify({ error: 'inventory read failed: ' + error.message }) };
      const rows = data || [];
      orders = orders.concat(rows);
      if (rows.length < PAGE || from > 200000) break;
    }
  }

  // ALSO pull unapproved rows still sitting in the Import tab (import_queue), so
  // revenue shows immediately without waiting for approval in the Inventory app.
  // Dedupe guarantee: approving a queue row sets its order_id and creates the
  // orders row, so filtering order_id IS NULL means a purchase is counted from
  // exactly one of the two tables at any moment.
  const exclStatuses = (process.env.INV_QUEUE_EXCLUDE_STATUSES || 'rejected,error,dismissed,duplicate,skipped')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  let queued = [];
  let queueReadError = null;
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await inv
        .from('import_queue')
        .select('source, order_date, total_amount, customer_name, status, order_id')
        .gte('order_date', dMin).lte('order_date', dMax)
        .in('source', ['quickbooks', 'ummasrecipe-store', 'wix'])
        .is('order_id', null)
        .order('order_date').range(from, from + PAGE - 1);
      if (error) { queueReadError = error.message; break; }   // non-fatal: confirmed orders still sync
      const rows = (data || []).filter(r => !exclStatuses.includes(String(r.status || '').toLowerCase()));
      queued = queued.concat(rows);
      if ((data || []).length < PAGE || from > 200000) break;
    }
  }

  // normalize both tables into one list for aggregation
  const allRows = orders.map(o => ({
    source: o.source, date: o.order_date, amt: Number(o.total_amount || 0),
    cust: o.customers && o.customers.name,
  })).concat(queued.map(q => ({
    source: q.source, date: q.order_date, amt: Number(q.total_amount || 0),
    cust: q.customer_name,
  })));

  // resolve Finance Tool corp ids, channels, categories
  const { data: corps } = await fin.from('corporations').select('id,code');
  const corpId = {}; corps.forEach(c => corpId[c.code] = c.id);
  const { data: hqChs } = await fin.from('revenue_channels').select('id,code').eq('corporation_id', corpId.HQ);
  const hqIngredients = (hqChs || []).find(c => c.code === 'ingredients');
  const { data: ummaChs } = await fin.from('revenue_channels').select('id,code').eq('corporation_id', corpId.UMMA);
  const ummaChId = {}; (ummaChs || []).forEach(c => ummaChId[c.code] = c.id);
  const storeCat = {};
  for (const code of ['AD', 'BW', 'FH']) {
    const { data: cat } = await fin.from('expense_categories').select('id')
      .eq('corporation_id', corpId[code]).eq('code', 'hq_supplies').maybeSingle();
    storeCat[code] = cat && cat.id;
  }

  // aggregate
  const hqRev = {};            // date -> amount
  const storeExp = {};         // store -> date -> amount
  const ummaRev = {};          // channel -> date -> amount
  for (const o of allRows) {
    const date = o.date;
    const amt = o.amt;
    if (!date || amt === 0) continue;
    const custName = o.cust;

    if (o.source === 'quickbooks') {
      hqRev[date] = (hqRev[date] || 0) + amt;
      const store = storeFor(custRules, custName);
      if (store && ['AD', 'BW', 'FH'].includes(store)) {
        storeExp[store] = storeExp[store] || {};
        storeExp[store][date] = (storeExp[store][date] || 0) + amt;
      }
      // Pearland / unknown: HQ revenue only
    } else {
      const ch = ummaMap[o.source] || 'other_rev';
      ummaRev[ch] = ummaRev[ch] || {};
      ummaRev[ch][date] = (ummaRev[ch][date] || 0) + amt;
    }
  }

  const upsertRev = async (corp, chId, date, amount) => {
    const { data: ex } = await fin.from('daily_revenue').select('id,source')
      .eq('corporation_id', corp).eq('channel_id', chId).eq('date', date).maybeSingle();
    if (ex && ex.source === 'manual') return;
    if (!ex && amount === 0) return;
    await fin.from('daily_revenue').upsert({
      corporation_id: corp, channel_id: chId, date, amount: +amount.toFixed(2),
      source: 'inventory', updated_at: new Date().toISOString(),
    }, { onConflict: 'corporation_id,channel_id,date' });
  };
  const upsertExp = async (corp, catId, date, amount) => {
    const { data: ex } = await fin.from('expenses').select('id')
      .eq('corporation_id', corp).eq('category_id', catId).eq('date', date)
      .eq('source', 'inventory').maybeSingle();
    if (ex) { await fin.from('expenses').update({ amount: +amount.toFixed(2) }).eq('id', ex.id); return; }
    if (amount === 0) return;
    await fin.from('expenses').insert({
      corporation_id: corp, category_id: catId, date, amount: +amount.toFixed(2),
      memo: 'HQ invoice (Inventory)', source: 'inventory',
    });
  };

  for (const date of dates) {
    if (hqIngredients) await upsertRev(corpId.HQ, hqIngredients.id, date, hqRev[date] || 0);
    for (const store of ['AD', 'BW', 'FH'])
      if (storeCat[store]) await upsertExp(corpId[store], storeCat[store], date, (storeExp[store] || {})[date] || 0);
    for (const [ch, byDate] of Object.entries(ummaRev))
      if (ummaChId[ch]) await upsertRev(corpId.UMMA, ummaChId[ch], date, byDate[date] || 0);
  }

  // sum helpers for the diagnostic response
  const sumByDate = obj => Object.values(obj).reduce((a, v) => a + v, 0);
  const ummaTotals = {};
  for (const [ch, byDate] of Object.entries(ummaRev)) ummaTotals[ch] = +sumByDate(byDate).toFixed(2);

  return { statusCode: 200, body: JSON.stringify({
    ok: true,
    orders: (orders || []).length,
    queuedUnapproved: queued.length,
    queuedUnapprovedTotal: +queued.reduce((a, q) => a + Number(q.total_amount || 0), 0).toFixed(2),
    queueReadError: queueReadError || undefined,
    range: `${dMin}~${dMax}`,
    hqRevenueTotal: +sumByDate(hqRev).toFixed(2),
    ummaRevenueByChannel: ummaTotals,
    ummaChannelsFound: Object.keys(ummaChId),
    sourcesSeen: [...new Set(allRows.map(o => o.source))],
  }) };
};
