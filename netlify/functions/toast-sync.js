// netlify/functions/toast-sync.js
// Daily scheduled sync. Pulls yesterday's (and the day before, for catch-up)
// orders from Toast for each store and writes:
//   - daily_revenue per channel: cash, card, uber, grubhub, doordash (source 'toast')
//   - card tips into the 'tips' expense category (source 'toast')
// Manual edits are respected: a row whose source is 'manual' is never overwritten.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   TOAST_CLIENT_ID, TOAST_CLIENT_SECRET
//   TOAST_API_HOST         (default https://ws-api.toasttab.com)
//   TOAST_RESTAURANTS      "AD:restaurant-guid,BW:restaurant-guid,FH:restaurant-guid"

const { createClient } = require('@supabase/supabase-js');

const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com';
const pad = n => String(n).padStart(2, '0');

function classifyOther(order, payment) {
  const bits = [];
  if (order.diningOption && order.diningOption.name) bits.push(order.diningOption.name);
  if (payment.otherPayment && payment.otherPayment.name) bits.push(payment.otherPayment.name);
  if (order.source) bits.push(order.source);
  const s = bits.join(' ').toLowerCase();
  if (s.includes('uber')) return 'uber';
  if (s.includes('door')) return 'doordash';
  if (s.includes('grub')) return 'grubhub';
  return 'card'; // unknown third-party: fold into card, tune after first live run
}

async function toastLogin() {
  const res = await fetch(`${HOST}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });
  if (!res.ok) throw new Error('Toast login failed: ' + res.status);
  const j = await res.json();
  return j.token.accessToken;
}

async function fetchOrders(token, guid, businessDate) {
  const orders = [];
  let page = 1;
  while (page < 40) {
    const res = await fetch(
      `${HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`,
      { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
    if (!res.ok) throw new Error(`orders ${businessDate} failed: ${res.status}`);
    const batch = await res.json();
    orders.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return orders;
}

function summarize(orders) {
  const sums = { cash: 0, card: 0, uber: 0, grubhub: 0, doordash: 0 };
  let tips = 0;
  for (const o of orders) {
    if (o.voided) continue;
    for (const chk of o.checks || []) {
      if (chk.voided || chk.deleted) continue;
      for (const p of chk.payments || []) {
        if (p.paymentStatus === 'VOIDED' || p.refundStatus === 'FULL') continue;
        const amt = Number(p.amount || 0);
        tips += Number(p.tipAmount || 0);
        if (p.type === 'CASH') sums.cash += amt;
        else if (p.type === 'CREDIT') sums.card += amt;
        else sums[classifyOther(o, p)] += amt;
      }
    }
  }
  Object.keys(sums).forEach(k => sums[k] = +sums[k].toFixed(2));
  return { sums, tips: +tips.toFixed(2) };
}

exports.handler = async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });

  const mapping = (process.env.TOAST_RESTAURANTS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const [code, guid] = s.split(':'); return { code, guid }; });
  if (!mapping.length)
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'TOAST_RESTAURANTS not configured' }) };

  // yesterday and the day before (catch-up / late adjustments)
  const dates = [1, 2].map(back => {
    const d = new Date(); d.setDate(d.getDate() - back);
    return { iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
             biz: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` };
  });

  const token = await toastLogin();
  const log = [];

  for (const { code, guid } of mapping) {
    const { data: corp } = await admin.from('corporations').select('id').eq('code', code).maybeSingle();
    if (!corp) { log.push(code + ': corporation not found'); continue; }

    const { data: channels } = await admin.from('revenue_channels')
      .select('id,code').eq('corporation_id', corp.id);
    const chId = {}; (channels || []).forEach(c => chId[c.code] = c.id);

    const { data: tipsCat } = await admin.from('expense_categories')
      .select('id').eq('corporation_id', corp.id).eq('code', 'tips').maybeSingle();

    for (const d of dates) {
      let summary;
      try { summary = summarize(await fetchOrders(token, guid, d.biz)); }
      catch (e) { log.push(`${code} ${d.iso}: ${e.message}`); continue; }

      // revenue rows: skip channels where a manual override exists
      for (const [ch, amount] of Object.entries(summary.sums)) {
        if (!chId[ch]) continue;
        const { data: existing } = await admin.from('daily_revenue').select('id,source')
          .eq('corporation_id', corp.id).eq('channel_id', chId[ch]).eq('date', d.iso).maybeSingle();
        if (existing && existing.source === 'manual') continue;
        await admin.from('daily_revenue').upsert({
          corporation_id: corp.id, channel_id: chId[ch], date: d.iso,
          amount, source: 'toast', updated_at: new Date().toISOString(),
        }, { onConflict: 'corporation_id,channel_id,date' });
      }

      // tips as an expense (one synced row per day)
      if (tipsCat) {
        const { data: exTip } = await admin.from('expenses').select('id')
          .eq('corporation_id', corp.id).eq('category_id', tipsCat.id)
          .eq('date', d.iso).eq('source', 'toast').maybeSingle();
        if (exTip) await admin.from('expenses').update({ amount: summary.tips }).eq('id', exTip.id);
        else if (summary.tips > 0) await admin.from('expenses').insert({
          corporation_id: corp.id, category_id: tipsCat.id, date: d.iso,
          amount: summary.tips, memo: 'Card tips (Toast)', source: 'toast',
        });
      }
      log.push(`${code} ${d.iso}: ok (tips ${summary.tips})`);
    }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, log }) };
};
