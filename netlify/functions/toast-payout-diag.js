// netlify/functions/toast-payout-diag.js
// READ-ONLY diagnostic. Does NOT write to the database or to Toast.
//
// Two checks in one call:
//   A) Payout API scope probe: tries the Toast analytics payout endpoints with the current
//      credentials and reports the HTTP status (200 = scope available, 401/403 = not granted,
//      404 = wrong path/host). This tells us whether we can auto-pull card fees / Toast
//      Delivery withholdings later.
//   B) Dining-option breakdown for one business date, per store: net revenue grouped by the
//      order's dining option name, plus how toast-sync would classify it (uber/doordash/
//      grubhub, or in-store -> card/cash). This shows where Toast Delivery / self online
//      orders actually land today (suspected: 'card').
//
// Usage: /.netlify/functions/toast-payout-diag?date=YYYY-MM-DD   (date optional; default = yesterday ET)
//
// Env vars reused from toast-sync: TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_API_HOST,
// TOAST_RESTAURANTS ("AD:guid,BW:guid,FH:guid").

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

// Same classification logic as toast-sync, but returns a readable channel label.
function channelLabel(doNameLower, paymentType) {
  if (doNameLower.includes('uber')) return 'uber';
  if (doNameLower.includes('doordash') || doNameLower.includes('door dash')) return 'doordash';
  if (doNameLower.includes('grubhub') || doNameLower.includes('grub hub')) return 'grubhub';
  return paymentType === 'CASH' ? 'cash' : 'card';
}

// Probe a payout endpoint and report status + a short body snippet (no throw).
async function probe(method, path, token, guid, body) {
  const out = { method, path, status: null, ok: false, note: '' };
  try {
    const headers = { Authorization: 'Bearer ' + token };
    if (guid) headers['Toast-Restaurant-External-ID'] = guid;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${HOST}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    out.status = res.status; out.ok = res.ok;
    const txt = (await res.text() || '').slice(0, 240);
    out.note = txt.replace(/\s+/g, ' ').trim();
  } catch (e) { out.note = 'fetch error: ' + e.message; }
  return out;
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
  // This endpoint returns raw Toast sales/payment data, so it must never be public.
  const qp0 = (event && event.queryStringParameters) || {};
  const okKey = qp0.key && qp0.key === process.env.WEBHOOK_SECRET;
  const hdrs = (event && event.headers) || {};
  const okOwner = !okKey && await isOwnerCaller(hdrs.authorization || hdrs.Authorization);
  if (!okKey && !okOwner) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const qp = qp0;
  const map = {};
  (process.env.TOAST_RESTAURANTS || '').split(',').map(s => s.trim()).filter(Boolean)
    .forEach(p => { const [c, g] = p.split(':'); map[c] = g; });

  // default date = yesterday Eastern
  let ymd, iso;
  if (qp.date) { iso = qp.date; ymd = qp.date.replace(/-/g, ''); }
  else {
    const local = new Date(Date.now() + -4 * 3600 * 1000); local.setDate(local.getDate() - 1);
    ymd = `${local.getFullYear()}${pad(local.getMonth() + 1)}${pad(local.getDate())}`;
    iso = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
  }

  let token;
  try { token = await login(); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }

  const firstGuid = Object.values(map)[0];

  // A) Payout scope probes (try a few documented shapes; report whatever comes back).
  const payoutProbes = [];
  payoutProbes.push(await probe('POST', '/era/v1/payout/payments/day', token, firstGuid,
    { startDate: ymd, endDate: ymd, restaurantIds: [firstGuid], excludedRestaurantIds: [] }));
  payoutProbes.push(await probe('POST', '/era/v1/payout/day', token, firstGuid,
    { startDate: ymd, endDate: ymd, restaurantIds: [firstGuid], excludedRestaurantIds: [] }));

  // B) Dining-option breakdown per store for the chosen date.
  const stores = {};
  for (const [code, guid] of Object.entries(map)) {
    let dn = {};
    try { dn = await diningNameMap(token, guid); } catch (e) {}
    let orders;
    try { orders = await fetchOrders(token, guid, ymd); }
    catch (e) { stores[code] = { error: e.message }; continue; }

    const byDining = {}; // diningName -> { net, channel }
    for (const o of orders) {
      if (o.voided) continue;
      let doName = '';
      if (o.diningOption) doName = o.diningOption.name || dn[o.diningOption.guid] || '';
      const key = doName || '(no dining option)';
      const low = doName.toLowerCase();
      for (const chk of o.checks || []) {
        if (chk.voided || chk.deleted) continue;
        for (const p of chk.payments || []) {
          if (p.paymentStatus === 'VOIDED') continue;
          const net = Number(p.amount || 0) - Number(p.tipAmount || 0);
          const ch = channelLabel(low, p.type);
          if (!byDining[key]) byDining[key] = { net: 0, channel: ch };
          byDining[key].net += net;
        }
      }
    }
    const rows = Object.entries(byDining)
      .map(([name, v]) => ({ diningOption: name, net: +v.net.toFixed(2), mappedChannel: v.channel }))
      .sort((a, b) => b.net - a.net);
    stores[code] = { orders: orders.length, diningOptions: rows };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: iso,
      note: 'Read-only. A=payout scope probe (look at status: 200 ok, 401/403 no scope, 404 wrong path). B=where each dining option lands today.',
      payoutScopeProbe: payoutProbes,
      diningBreakdown: stores,
    }, null, 2),
  };
};
