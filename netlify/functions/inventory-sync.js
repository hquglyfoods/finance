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
const { captureSnapshot } = require('./lib/snapshots.js');
const pad = n => String(n).padStart(2, '0');

// Postgres timestamptz -> YYYY-MM-DD in the store's timezone (default America/New_York).
// A late-evening New York order otherwise lands on the next UTC day.
function localDateFromTs(ts) {
  if (!ts) return null;
  const iso = String(ts).replace(' ', 'T').replace(/(\.\d+)?\+00(:00)?$/, 'Z');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(ts).slice(0, 10);   // fallback: raw date part
  const tz = process.env.STORE_TIMEZONE || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

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
        .select('source, order_date, total_amount, customer_id, external_id, customers(name)')
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

  // UMMA store orders land in incoming_store_orders FIRST (status 'new'), and an
  // orders row is only created when someone fulfills/approves them in the Inventory
  // app. Count the not-yet-fulfilled ones so revenue books immediately.
  // There is no link column, so dedupe uses a DOUBLE guard - a row is skipped if
  // EITHER (a) its order_no already exists as an orders.external_id (the approval
  // wrote it through), OR (b) its status says it was fulfilled/cancelled. Either
  // guard alone prevents double counting; together they are safe even if one
  // assumption about the Inventory app is wrong.
  const incomingExcl = (process.env.INV_INCOMING_EXCLUDE_STATUSES || 'fulfilled,cancelled,canceled,rejected,refunded')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const knownExternalIds = new Set(orders.map(o => String(o.external_id || '')).filter(Boolean));
  let incoming = [];
  let incomingReadError = null;
  {
    // created_at is a timestamptz; cover the whole dMax day
    const nd = new Date(dMax + 'T00:00:00Z'); nd.setUTCDate(nd.getUTCDate() + 1);
    const dMaxNext = `${nd.getUTCFullYear()}-${pad(nd.getUTCMonth() + 1)}-${pad(nd.getUTCDate())}`;
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await inv
        .from('incoming_store_orders')
        .select('source, order_no, total, status, created_at')
        .gte('created_at', dMin).lt('created_at', dMaxNext)
        .in('source', ['ummasrecipe-store', 'wix'])
        .order('created_at').range(from, from + PAGE - 1);
      if (error) { incomingReadError = error.message; break; }   // non-fatal
      const rows = (data || []).filter(r =>
        !incomingExcl.includes(String(r.status || '').toLowerCase())
        && !knownExternalIds.has(String(r.order_no || '')));
      incoming = incoming.concat(rows);
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
  }))).concat(incoming.map(r => ({
    // date from created_at in the STORE's timezone (not UTC): an order placed in
    // the evening in New York books to that day, not the next (same handling as
    // slack-expense). Approved orders keep the Inventory app's order_date; only
    // not-yet-approved incoming rows are computed here.
    source: r.source, date: localDateFromTs(r.created_at), amt: Number(r.total || 0),
    cust: null,
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
    // Manual income can repeat on the same channel and day now, so target only the row
    // this sync owns (source='inventory'). Hand-entered rows are never touched, and the
    // sync still holds exactly one row per day.
    const { data: exRows } = await fin.from('daily_revenue').select('id,amount')
      .eq('corporation_id', corp).eq('channel_id', chId).eq('date', date)
      .eq('source', 'inventory').limit(1);
    const ex = (exRows || [])[0];
    if (!ex && amount === 0) return;
    if (ex && Number(ex.amount) === +amount.toFixed(2)) return;   // unchanged: no write
    if (ex) {
      await fin.from('daily_revenue').update({
        amount: +amount.toFixed(2), updated_at: new Date().toISOString(),
      }).eq('id', ex.id);
    } else {
      await fin.from('daily_revenue').insert({
        corporation_id: corp, channel_id: chId, date, amount: +amount.toFixed(2),
        source: 'inventory', updated_at: new Date().toISOString(),
      });
    }
  };
  const upsertExp = async (corp, catId, date, amount) => {
    const { data: ex } = await fin.from('expenses').select('id,amount')
      .eq('corporation_id', corp).eq('category_id', catId).eq('date', date)
      .eq('source', 'inventory').maybeSingle();
    if (ex && Number(ex.amount) === +amount.toFixed(2)) return;   // unchanged: no write
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

  // Intraday snapshot of today's running totals for HQ and UMMA (for the Home
  // "same time last week" comparison). Skipped during explicit-range backfills.
  // Fail-soft: a snapshot problem must never break the sync.
  const snapErrors = [];
  if (!(qs.from && qs.to)) {
    const tz = 'America/New_York';
    const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // YYYY-MM-DD
    for (const code of ['HQ', 'UMMA']) {
      if (!corpId[code]) continue;
      try { await captureSnapshot(fin, corpId[code], etToday, tz); }
      catch (e) { snapErrors.push(`${code}: ${e.message}`); }
    }
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
    incomingNew: incoming.length,
    incomingNewTotal: +incoming.reduce((a, r) => a + Number(r.total || 0), 0).toFixed(2),
    queueReadError: queueReadError || undefined,
    incomingReadError: incomingReadError || undefined,
    range: `${dMin}~${dMax}`,
    hqRevenueTotal: +sumByDate(hqRev).toFixed(2),
    ummaRevenueByChannel: ummaTotals,
    ummaChannelsFound: Object.keys(ummaChId),
    sourcesSeen: [...new Set(allRows.map(o => o.source))],
    snapshotErrors: snapErrors.length ? snapErrors : undefined,
  }) };
};
