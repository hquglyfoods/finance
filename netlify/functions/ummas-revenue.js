// netlify/functions/ummas-revenue.js
// Webhook for the Ummas Recipe website (custom-built) to report daily revenue.
// The website calls this once a day (or on every update; upsert is idempotent):
//
//   POST {SITE}/.netlify/functions/ummas-revenue
//   Header: x-ummas-secret: {UMMAS_WEBHOOK_SECRET}
//   Body: { "date": "2026-07-04", "ugly": 1250.00, "franchise": 800.00, "other_rev": 431.00 }
//
// Any channel key may be omitted. Manual overrides are never touched.
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, UMMAS_WEBHOOK_SECRET

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const secret = event.headers['x-ummas-secret'] || event.headers['X-Ummas-Secret'];
  if (!secret || secret !== process.env.UMMAS_WEBHOOK_SECRET)
    return { statusCode: 403, body: 'Forbidden' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || ''))
    return { statusCode: 400, body: 'date must be YYYY-MM-DD' };

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });
  const { data: corp } = await admin.from('corporations').select('id').eq('code', 'UMMA').maybeSingle();
  const { data: channels } = await admin.from('revenue_channels').select('id,code').eq('corporation_id', corp.id);
  const chId = {}; (channels || []).forEach(c => chId[c.code] = c.id);

  const written = [];
  for (const ch of ['ugly', 'franchise', 'other_rev']) {
    if (body[ch] === undefined || !chId[ch]) continue;
    const amount = Number(body[ch]);
    if (isNaN(amount)) continue;
    const { data: existing } = await admin.from('daily_revenue').select('id,source')
      .eq('corporation_id', corp.id).eq('channel_id', chId[ch]).eq('date', body.date).maybeSingle();
    if (existing && existing.source === 'manual') continue;
    await admin.from('daily_revenue').upsert({
      corporation_id: corp.id, channel_id: chId[ch], date: body.date,
      amount: +amount.toFixed(2), source: 'website', updated_at: new Date().toISOString(),
    }, { onConflict: 'corporation_id,channel_id,date' });
    written.push(ch);
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, written }) };
};
