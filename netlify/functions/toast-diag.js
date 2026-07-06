// netlify/functions/toast-diag.js
// TEMPORARY diagnostic. Fetches one business day of Toast orders for one store
// and returns a breakdown of payment types / delivery sources so we can fix the
// sync mapping precisely. Protected by a secret. Remove after debugging.
//
// Call: /.netlify/functions/toast-diag?key=WEBHOOK_SECRET&store=AD&date=20260704
//
// Env: TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANTS, WEBHOOK_SECRET,
//      TOAST_API_HOST (optional)

const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com';

async function login() {
  const res = await fetch(`${HOST}/authentication/v1/authentication/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });
  if (!res.ok) throw new Error('login ' + res.status);
  return (await res.json()).token.accessToken;
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.key !== process.env.WEBHOOK_SECRET) return { statusCode: 403, body: 'Forbidden' };

  const map = {};
  (process.env.TOAST_RESTAURANTS || '').split(',').map(s => s.trim()).filter(Boolean)
    .forEach(p => { const [c, g] = p.split(':'); map[c] = g; });
  const guid = map[q.store || 'AD'];
  if (!guid) return { statusCode: 400, body: 'unknown store' };
  const date = q.date || (() => { const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; })();

  try {
    const token = await login();
    let orders = [], page = 1;
    while (page < 20) {
      const res = await fetch(`${HOST}/orders/v2/ordersBulk?businessDate=${date}&pageSize=100&page=${page}`,
        { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
      if (!res.ok) return { statusCode: 200, body: JSON.stringify({ error: 'orders ' + res.status, date, guid }) };
      const batch = await res.json();
      orders.push(...batch);
      if (batch.length < 100) break;
      page++;
    }

    // Aggregate payment types and delivery sources without exposing customer data
    const byType = {}, bySource = {}, byDining = {};
    const rawSamples = [];
    let grossPayments = 0, tips = 0, refunds = 0, voidedPay = 0;
    const sampleOther = [];

    for (const o of orders) {
      if (o.voided) continue;
      const src = o.source || 'null';
      bySource[src] = (bySource[src] || 0) + 1;
      // capture delivery-looking orders in full
      if (typeof capture !== 'undefined') {}
      const dining = (o.diningOption && o.diningOption.name) || 'null';
      byDining[dining] = (byDining[dining] || 0) + 1;
      // grab full raw for any order whose source isn't Kiosk (likely delivery/online)
      if ((o.source && o.source !== 'Kiosk') && rawSamples.length < 6) {
        rawSamples.push({
          source: o.source,
          diningOption: o.diningOption || null,
          checks: (o.checks || []).map(ch => ({
            payments: (ch.payments || []).map(p => ({
              type: p.type, amount: p.amount, tip: p.tipAmount,
              otherPayment: p.otherPayment || null, cardType: p.cardType || null,
            })),
          })),
        });
      }
      for (const chk of o.checks || []) {
        if (chk.voided || chk.deleted) continue;
        for (const p of chk.payments || []) {
          const t = p.type || 'UNKNOWN';
          const status = p.paymentStatus || '';
          const refund = p.refundStatus || '';
          if (status === 'VOIDED') { voidedPay += Number(p.amount||0); continue; }
          byType[t] = byType[t] || { count: 0, amount: 0, tip: 0 };
          byType[t].count++;
          byType[t].amount += Number(p.amount || 0);
          byType[t].tip += Number(p.tipAmount || 0);
          grossPayments += Number(p.amount || 0);
          tips += Number(p.tipAmount || 0);
          if (refund === 'FULL' || refund === 'PARTIAL') refunds += Number(p.refundAmount || p.amount || 0);
          if (t === 'OTHER' && sampleOther.length < 12) {
            sampleOther.push({
              amount: p.amount, tip: p.tipAmount,
              paymentKeys: Object.keys(p),
              otherPayment: p.otherPayment || null,
              cardType: p.cardType || null,
              orderSource: src,
              orderSourceRaw: o.source,
            });
          }
        }
      }
    }
    // round
    for (const k in byType) { byType[k].amount = +byType[k].amount.toFixed(2); byType[k].tip = +byType[k].tip.toFixed(2); }

    return { statusCode: 200, body: JSON.stringify({
      date, store: q.store, orderCount: orders.length,
      grossPayments: +grossPayments.toFixed(2), tips: +tips.toFixed(2),
      refunds: +refunds.toFixed(2), voidedPayments: +voidedPay.toFixed(2),
      netExTips: +(grossPayments - tips).toFixed(2),
      byPaymentType: byType,
      byOrderSource: bySource,
      byDiningOption: byDining,
      sampleOtherPayments: sampleOther,
      rawNonKioskOrders: rawSamples,
    }, null, 2) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
