// netlify/functions/toast-sync.js
// Hourly sync of Toast sales for each store (AD/BW/FH).
//
// Channel mapping (dining option takes priority, to avoid double counting):
//   - Order dining option "Uber Eats*"  -> uber channel
//   - Order dining option "DoorDash*"   -> doordash channel
//   - Order dining option "Grubhub*"    -> grubhub channel
//   - Any other order (Take Out, Online Ordering, Kiosk, dine in, etc.):
//         payment type CASH   -> cash channel
//         everything else     -> card channel
//   Delivery orders are NOT added to card, even though they settle by card,
//   so revenue is never counted twice.
//
// Amounts are TAX-INCLUSIVE (matches the Excel closing board). Sales tax is
// handled as an automatic expense rule in the app, not deducted here.
// Tips are excluded from revenue and booked into the 'tips' expense category.
//
// Business date handling: we pull each store's own business date. "Today" is
// still in progress, so by default we sync the last 2 completed business days
// (yesterday and the day before) for catch-up, plus today's in-progress figure
// flagged so the app can show it as provisional.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   TOAST_CLIENT_ID, TOAST_CLIENT_SECRET
//   TOAST_API_HOST         (default https://ws-api.toasttab.com)
//   TOAST_RESTAURANTS      "AD:guid,BW:guid,FH:guid"

const { createClient } = require('@supabase/supabase-js');

const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com';
const pad = n => String(n).padStart(2, '0');

async function login() {
  const res = await fetch(`${HOST}/authentication/v1/authentication/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });
  if (!res.ok) throw new Error('Toast login ' + res.status);
  return (await res.json()).token.accessToken;
}

async function diningNameMap(token, guid) {
  const map = {};
  try {
    const res = await fetch(`${HOST}/config/v2/diningOptions`,
      { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
    if (res.ok) (await res.json() || []).forEach(d => { if (d.guid) map[d.guid] = (d.name || '').toLowerCase(); });
  } catch (e) {}
  return map;
}

async function fetchOrders(token, guid, businessDate) {
  let orders = [], page = 1;
  while (page < 100) {
    const res = await fetch(`${HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`,
      { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
    if (!res.ok) throw new Error(`orders ${businessDate} ${res.status}`);
    const batch = await res.json();
    orders.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return orders;
}

// classify a single order into a channel code
function channelFor(order, diningNames) {
  let doName = '';
  if (order.diningOption) {
    doName = order.diningOption.name || diningNames[order.diningOption.guid] || '';
  }
  doName = doName.toLowerCase();
  if (doName.includes('uber')) return { delivery: 'uber' };
  if (doName.includes('doordash') || doName.includes('door dash')) return { delivery: 'doordash' };
  if (doName.includes('grubhub') || doName.includes('grub hub')) return { delivery: 'grubhub' };
  return { delivery: null }; // in-store: decide by payment type
}

function summarize(orders, diningNames) {
  const sums = { cash: 0, card: 0, uber: 0, grubhub: 0, doordash: 0 };
  let tips = 0;
  for (const o of orders) {
    if (o.voided) continue;
    const { delivery } = channelFor(o, diningNames);
    for (const chk of o.checks || []) {
      if (chk.voided || chk.deleted) continue;
      for (const p of chk.payments || []) {
        if (p.paymentStatus === 'VOIDED') continue;
        const amt = Number(p.amount || 0);          // tax-inclusive
        const tip = Number(p.tipAmount || 0);
        tips += tip;
        const net = amt - tip;                       // exclude tip from revenue
        if (delivery) { sums[delivery] += net; continue; }
        if (p.type === 'CASH') sums.cash += net;
        else sums.card += net;                       // CREDIT + OTHER(online) -> card
      }
    }
  }
  for (const k in sums) sums[k] = +sums[k].toFixed(2);
  return { sums, tips: +tips.toFixed(2) };
}

// business date string YYYYMMDD for N days ago in a fixed offset (store local ~ ET)
function bizDates() {
  // Use ET (UTC-4/5). Toast business day rolls at ~4am local. We sync the last
  // 2 completed days plus today (provisional).
  const now = new Date();
  const et = new Date(now.getTime() - 4 * 3600 * 1000); // approx ET
  const list = [];
  for (let back = 0; back <= 2; back++) {
    const d = new Date(et); d.setDate(d.getDate() - back);
    list.push({
      ymd: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
      iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      provisional: back === 0,
    });
  }
  return list;
}

exports.handler = async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });

  const map = {};
  (process.env.TOAST_RESTAURANTS || '').split(',').map(s => s.trim()).filter(Boolean)
    .forEach(p => { const [c, g] = p.split(':'); map[c] = g; });

  let token;
  try { token = await login(); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }

  const log = [];
  for (const [code, guid] of Object.entries(map)) {
    const { data: corp } = await admin.from('corporations').select('id').eq('code', code).maybeSingle();
    if (!corp) { log.push(`${code}: no corp`); continue; }
    const { data: chs } = await admin.from('revenue_channels').select('id,code').eq('corporation_id', corp.id);
    const chId = {}; (chs || []).forEach(c => chId[c.code] = c.id);
    const { data: tipCat } = await admin.from('expense_categories').select('id')
      .eq('corporation_id', corp.id).eq('code', 'tips').maybeSingle();

    let dn = {};
    try { dn = await diningNameMap(token, guid); } catch (e) {}

    for (const d of bizDates()) {
      let orders;
      try { orders = await fetchOrders(token, guid, d.ymd); }
      catch (e) { log.push(`${code} ${d.ymd}: ${e.message}`); continue; }
      const { sums, tips } = summarize(orders, dn);

      // upsert each channel (skip 'manual' rows). Provisional (today) rows are
      // marked source 'toast_live' so the app can show them as in progress.
      const src = d.provisional ? 'toast_live' : 'toast';
      for (const chCode of ['cash', 'card', 'uber', 'grubhub', 'doordash']) {
        if (!chId[chCode]) continue;
        const amount = sums[chCode] || 0;
        const { data: ex } = await admin.from('daily_revenue').select('id,source')
          .eq('corporation_id', corp.id).eq('channel_id', chId[chCode]).eq('date', d.iso).maybeSingle();
        if (ex && ex.source === 'manual') continue;
        if (!ex && amount === 0) continue;
        await admin.from('daily_revenue').upsert({
          corporation_id: corp.id, channel_id: chId[chCode], date: d.iso,
          amount, source: src, updated_at: new Date().toISOString(),
        }, { onConflict: 'corporation_id,channel_id,date' });
      }

      // tips -> expense (only for completed days, not the live provisional one,
      // to avoid churn; the final sync of that day books tips)
      if (tipCat && !d.provisional) {
        const { data: ex } = await admin.from('expenses').select('id,source')
          .eq('corporation_id', corp.id).eq('category_id', tipCat.id).eq('date', d.iso)
          .eq('source', 'toast').maybeSingle();
        if (ex) { await admin.from('expenses').update({ amount: tips }).eq('id', ex.id); }
        else if (tips > 0) {
          await admin.from('expenses').insert({
            corporation_id: corp.id, category_id: tipCat.id, date: d.iso,
            amount: tips, memo: 'Card tips (Toast)', source: 'toast',
          });
        }
      }
      log.push(`${code} ${d.iso}${d.provisional ? ' (live)' : ''}: cash ${sums.cash} card ${sums.card} uber ${sums.uber} gh ${sums.grubhub} dd ${sums.doordash} tips ${tips}`);
    }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, log }) };
};
