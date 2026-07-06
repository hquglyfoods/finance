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

exports.handler = async () => {
  const fin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });
  const inv = createClient(process.env.INV_SUPABASE_URL, process.env.INV_SUPABASE_READ_KEY,
    { auth: { persistSession: false } });

  const custRules = parseCustomerMap(process.env.INV_CUSTOMER_MAP) || DEFAULT_CUSTOMER_MAP;
  const ummaMap = parseUmmaMap(process.env.INV_UMMA_MAP) || DEFAULT_UMMA_MAP;

  // date window: default last 10 days, or an explicit range via ?from=&to=
  // (use the range to backfill months of history, e.g. UMMA orders).
  const qs = (event && event.queryStringParameters) || {};
  let dMin, dMax;
  if (qs.from && qs.to) {
    dMin = qs.from; dMax = qs.to;
  } else {
    const dates = [];
    for (let back = 1; back <= 10; back++) {
      const d = new Date(); d.setDate(d.getDate() - back);
      dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
    dMin = dates[dates.length - 1]; dMax = dates[0];
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
  for (const o of orders || []) {
    const date = o.order_date;
    const amt = Number(o.total_amount || 0);
    if (!date || amt === 0) continue;
    const custName = o.customers && o.customers.name;

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

  return { statusCode: 200, body: JSON.stringify({
    ok: true, orders: (orders || []).length, range: `${dMin}~${dMax}`,
  }) };
};
