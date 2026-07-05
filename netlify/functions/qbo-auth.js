// netlify/functions/qbo-auth.js
// One-time QuickBooks Online connection for HQ revenue sync.
// 1. Visit: {SITE}/.netlify/functions/qbo-auth?action=start&key={QBO_SETUP_SECRET}
// 2. Sign in to Intuit and approve. Tokens are stored in integration_tokens.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, QBO_CLIENT_ID, QBO_CLIENT_SECRET,
//           QBO_SETUP_SECRET, SITE_URL (e.g. https://uglyfinance.netlify.app)

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const redirect = (process.env.SITE_URL || '') + '/.netlify/functions/qbo-auth';

  if (q.action === 'start') {
    if (q.key !== process.env.QBO_SETUP_SECRET)
      return { statusCode: 403, body: 'Forbidden' };
    const url = 'https://appcenter.intuit.com/connect/oauth2'
      + '?client_id=' + encodeURIComponent(process.env.QBO_CLIENT_ID)
      + '&redirect_uri=' + encodeURIComponent(redirect)
      + '&response_type=code&scope=com.intuit.quickbooks.accounting'
      + '&state=' + encodeURIComponent(process.env.QBO_SETUP_SECRET);
    return { statusCode: 302, headers: { Location: url } };
  }

  if (q.code && q.realmId) {
    if (q.state !== process.env.QBO_SETUP_SECRET)
      return { statusCode: 403, body: 'Bad state' };
    const basic = Buffer.from(process.env.QBO_CLIENT_ID + ':' + process.env.QBO_CLIENT_SECRET).toString('base64');
    const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: redirect }),
    });
    const tok = await res.json();
    if (!res.ok) return { statusCode: 400, body: 'Token exchange failed: ' + JSON.stringify(tok) };

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } });
    await admin.from('integration_tokens').upsert({
      id: 'qbo',
      data: { refresh_token: tok.refresh_token, realm_id: q.realmId },
      updated_at: new Date().toISOString(),
    });
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' },
      body: '<h2>QuickBooks connected.</h2><p>You can close this tab. Daily HQ sync is now active.</p>' };
  }

  return { statusCode: 400, body: 'Missing parameters' };
};
