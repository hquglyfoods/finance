// ============================================================================
// toast-probe: READ-ONLY diagnostic. Discovers what the Toast API exposes about
// restaurants so we can build automatic store matching + per-store timezone.
//
// It does NOT write to our database. It just calls Toast and returns the raw
// shape of two things we need:
//   1. The restaurant config for a known GUID (does it include a timezone?).
//   2. The list of restaurants our credential can see (for auto-discovery).
//
// Usage:  /.netlify/functions/toast-probe?guid=<restaurantGuid>
//   - guid optional; defaults to the first entry in TOAST_RESTAURANTS.
//
// Auth: same Toast credential the sync uses. No DB access, no side effects.
// ============================================================================

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
  if (!res.ok) throw new Error('Toast login ' + res.status);
  return (await res.json()).token.accessToken;
}

// Try a Toast endpoint and capture status + a trimmed body so we can see the shape.
async function probe(url, headers) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    return { url, status: res.status, ok: res.ok, body };
  } catch (e) {
    return { url, error: e.message };
  }
}

exports.handler = async (event) => {
  const qp = event.queryStringParameters || {};
  // default guid: first restaurant in the env list
  const first = (process.env.TOAST_RESTAURANTS || '').split(',')[0] || '';
  const guid = qp.guid || (first.includes(':') ? first.split(':')[1] : first);

  let token;
  try { token = await login(); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ step: 'login', error: e.message }) }; }

  const authOnly = { Authorization: 'Bearer ' + token };
  const withGuid = { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid };

  const results = {};

  // (1) Restaurant config for a specific GUID - this is where a timezone usually lives.
  //     Toast's config API: /restaurants/v1/restaurants/{guid}
  results.restaurant_by_guid = await probe(
    `${HOST}/restaurants/v1/restaurants/${guid}`, withGuid);

  // (2) Some tenants expose the restaurant under config/v2 as well; try it as a fallback.
  results.config_general = await probe(
    `${HOST}/config/v2/restaurants`, withGuid);

  // (3) The list of restaurants the credential can access (for auto-discovery of new
  //     franchise stores). Partner/management style endpoint.
  results.restaurants_list = await probe(
    `${HOST}/partners/v1/restaurants`, authOnly);

  // Pull just the timezone-ish fields out of the config response if present, so the
  // answer is obvious without reading the whole blob.
  const rb = results.restaurant_by_guid && results.restaurant_by_guid.body;
  const tzHint = {};
  if (rb && typeof rb === 'object') {
    const g = rb.general || rb;
    tzHint.timeZone = g.timeZone || g.timezone || rb.timeZone || null;
    tzHint.name = g.name || rb.name || null;
    tzHint.locationName = g.locationName || null;
    tzHint.closeoutHour = g.closeoutHour || null;
    tzHint.managementGroupGuid = g.managementGroupGuid || null;
  }
  results.timezone_hint = tzHint;

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guid, results }, null, 2),
  };
};
