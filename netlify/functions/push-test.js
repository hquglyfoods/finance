// netlify/functions/push-test.js
// In-app push diagnostic. Owner-only. Bypasses the Supabase webhook and fires a real
// Web Push to the CALLER's own subscriptions, reporting each step as JSON so we can
// see exactly where push breaks (env var missing / key won't load / send status).
//
// Call from the app (owner JWT in the Authorization header):
//   POST /.netlify/functions/push-test
//
// Returns JSON like:
//   { ok: true, steps: { envPublic, envPrivate, keyLoads, keyType, subscriptions,
//                        sent, results:[{endpoint, status, error, gone}] } }
//
// Env vars used: SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY,
//                VAPID_PRIVATE_KEY, VAPID_SUBJECT (optional).

const crypto = require('crypto');
const { sendPush, loadVapidPrivateKey } = require('./lib/push.js');

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

// Verify the caller is an authenticated owner via their Supabase JWT.
async function ownerFromAuth(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const res = await fetch(`${SB}/auth/v1/user`, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !user.id) return null;
    const pr = await fetch(`${SB}/rest/v1/profiles?id=eq.${user.id}&select=id,role`, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
    });
    const rows = await pr.json();
    if (rows && rows[0] && rows[0].role === 'owner') return rows[0].id;
    return null;
  } catch (e) { return null; }
}

exports.handler = async (event) => {
  const steps = {};
  try {
    const ownerId = await ownerFromAuth(event.headers.authorization || event.headers.Authorization);
    if (!ownerId) return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Owner authentication required' }) };

    // 1. env var presence
    const pub = process.env.VAPID_PUBLIC_KEY || '';
    const priv = process.env.VAPID_PRIVATE_KEY || '';
    steps.envPublic = pub ? 'present' : 'MISSING';
    steps.envPrivate = priv ? 'present' : 'MISSING';
    steps.subject = process.env.VAPID_SUBJECT || 'mailto:hq@uglydonutsncorndogs.com';

    // 2. does the private key actually load as an EC key?
    let keyOk = false, keyType = null, keyError = null, keyFormat = null;
    if (!priv.includes('BEGIN')) keyFormat = 'base64-or-escaped (normalized)';
    else keyFormat = 'PEM';
    try {
      const pem = loadVapidPrivateKey(priv);
      const ko = crypto.createPrivateKey(pem);
      keyType = ko.asymmetricKeyType;         // expect 'ec'
      keyOk = keyType === 'ec';
    } catch (e) { keyError = String(e.message || e); }
    steps.keyFormat = keyFormat;
    steps.keyLoads = keyOk;
    steps.keyType = keyType;
    if (keyError) steps.keyError = keyError;

    // 3. this owner's push subscriptions
    let subs = [];
    try {
      const r = await fetch(`${SB}/rest/v1/push_subscriptions?profile_id=eq.${ownerId}&select=*`, {
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
      });
      subs = r.ok ? await r.json() : [];
    } catch (e) { steps.subsError = String(e.message || e); }
    steps.subscriptions = subs.length;

    if (!keyOk) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'private key did not load as an EC key', steps }) };
    }
    if (subs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'no push subscriptions for this account (enable notifications first, from the installed app)', steps }) };
    }

    // 4. fire a real test push to each of the owner's subscriptions
    const opts = { publicKey: pub, privateKey: priv, subject: steps.subject };
    const results = [];
    let sent = 0, gone = 0;
    for (const row of subs) {
      const ep = (row.endpoint || '').slice(0, 60) + '...';
      try {
        const res = await sendPush(row.subscription, {
          title: 'Ugly Finance test push',
          body: 'If you can read this, web push is working.',
          badge: 0, tag: 'push-test',
        }, opts);
        if (res.gone) { gone++; results.push({ endpoint: ep, gone: true }); }
        else { if (res.ok) sent++; results.push({ endpoint: ep, status: res.status, ok: res.ok }); }
      } catch (e) {
        results.push({ endpoint: ep, error: String(e.message || e) });
      }
    }
    steps.sent = sent;
    steps.gone = gone;
    steps.results = results;

    return { statusCode: 200, body: JSON.stringify({ ok: sent > 0, steps }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e), steps }) };
  }
};
