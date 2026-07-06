// netlify/functions/toast-diag.js
// In-app diagnostic: returns a full breakdown for one store + business date so
// the Diagnostics screen can compare our API pull against the Toast dashboard.
// Protected by WEBHOOK_SECRET. Safe to keep (read-only).
//
// Call: /.netlify/functions/toast-diag?key=SECRET&store=AD&date=YYYYMMDD

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

// Verify the caller is an authenticated owner via their Supabase JWT.
async function isOwnerCaller(authHeader) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return false;
    const user = await res.json();
    if (!user || !user.id) return false;
    const pr = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY },
    });
    const rows = await pr.json();
    return rows && rows[0] && rows[0].role === 'owner';
  } catch (e) { return false; }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const okKey = q.key && q.key === process.env.WEBHOOK_SECRET;
  const okOwner = !okKey && await isOwnerCaller((event.headers || {}).authorization || (event.headers || {}).Authorization);
  if (!okKey && !okOwner) return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden' }) };

  const map = {};
  (process.env.TOAST_RESTAURANTS || '').split(',').map(s => s.trim()).filter(Boolean)
    .forEach(p => { const [c, g] = p.split(':'); map[c] = g; });
  const guid = map[q.store || 'AD'];
  if (!guid) return { statusCode: 400, body: JSON.stringify({ error: 'unknown store' }) };
  const date = q.date || (() => { const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; })();

  const headers = { 'Content-Type': 'application/json' };
  try {
    const token = await login();

    // Pull ALL pages, tracking how many pages we walked
    let orders = [], page = 1, pages = 0;
    while (page < 100) {
      const res = await fetch(`${HOST}/orders/v2/ordersBulk?businessDate=${date}&pageSize=100&page=${page}`,
        { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
      if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ error: 'orders ' + res.status, date, guid }) };
      const batch = await res.json();
      pages++;
      orders.push(...batch);
      if (batch.length < 100) break;
      page++;
    }

    // Channel classification, tracking EVERY distinct signal
    const bySource = {};       // order.source counts + $
    const byPayType = {};      // payment.type counts + $
    const byOtherName = {};    // otherPayment.name -> $  (delivery platforms live here)
    let cash = 0, credit = 0, other = 0, tips = 0, refunds = 0, voided = 0;
    let salesExTips = 0;

    for (const o of orders) {
      if (o.voided) continue;
      const src = (o.source || 'null');
      bySource[src] = bySource[src] || { count: 0, amount: 0 };
      bySource[src].count++;
      for (const chk of o.checks || []) {
        if (chk.voided || chk.deleted) continue;
        for (const p of chk.payments || []) {
          if (p.paymentStatus === 'VOIDED') { voided += Number(p.amount || 0); continue; }
          const amt = Number(p.amount || 0);
          const tip = Number(p.tipAmount || 0);
          bySource[src].amount += amt;
          const t = p.type || 'UNKNOWN';
          byPayType[t] = byPayType[t] || { count: 0, amount: 0, tip: 0 };
          byPayType[t].count++; byPayType[t].amount += amt; byPayType[t].tip += tip;
          tips += tip;
          if (p.refundStatus === 'FULL' || p.refundStatus === 'PARTIAL')
            refunds += Number(p.refundAmount || 0);
          if (t === 'CASH') cash += amt;
          else if (t === 'CREDIT') credit += amt;
          else {
            other += amt;
            const name = (p.otherPayment && (p.otherPayment.name || p.otherPayment.type))
              || o.source || 'OTHER';
            byOtherName[name] = (byOtherName[name] || 0) + amt;
          }
          salesExTips += (amt - tip);
        }
      }
    }
    const round = o => { for (const k in o) if (typeof o[k] === 'number') o[k] = +o[k].toFixed(2); return o; };
    for (const k in bySource) round(bySource[k]);
    for (const k in byPayType) round(byPayType[k]);
    for (const k in byOtherName) byOtherName[k] = +byOtherName[k].toFixed(2);

    return { statusCode: 200, headers, body: JSON.stringify({
      date, store: q.store, pagesWalked: pages, ordersReturned: orders.length,
      salesExTips: +salesExTips.toFixed(2), tips: +tips.toFixed(2),
      refunds: +refunds.toFixed(2), voided: +voided.toFixed(2),
      channels: { cash: +cash.toFixed(2), credit: +credit.toFixed(2), other: +other.toFixed(2) },
      byOrderSource: bySource,
      byPaymentType: byPayType,
      otherPaymentBreakdown: byOtherName,
    }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: e.message }) };
  }
};
