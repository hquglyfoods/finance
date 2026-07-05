// netlify/functions/quickbooks-sync.js
// Daily scheduled sync of HQ revenue from QuickBooks Online.
// Reads yesterday's (and day-before's) Invoices + SalesReceipts, classifies each
// line into HQ channels (ingredients / royalty / other_rev) by item or account
// name, and upserts daily_revenue (source 'quickbooks').
// Manual overrides (source 'manual') are never touched.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, QBO_CLIENT_ID, QBO_CLIENT_SECRET
// Optional: QBO_CHANNEL_MAP  substring rules, default "ingredient=ingredients;royalt=royalty"

const { createClient } = require('@supabase/supabase-js');

const pad = n => String(n).padStart(2, '0');
const QBO_API = 'https://quickbooks.api.intuit.com';

function channelFor(name, rules) {
  const s = (name || '').toLowerCase();
  for (const r of rules) if (s.includes(r.match)) return r.channel;
  return 'other_rev';
}

exports.handler = async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });

  const { data: tokRow } = await admin.from('integration_tokens').select('data').eq('id', 'qbo').maybeSingle();
  if (!tokRow) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'QuickBooks not connected yet (run qbo-auth)' }) };

  // refresh access token (QBO rotates refresh tokens: always store the new one)
  const basic = Buffer.from(process.env.QBO_CLIENT_ID + ':' + process.env.QBO_CLIENT_SECRET).toString('base64');
  const rres = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokRow.data.refresh_token }),
  });
  const tok = await rres.json();
  if (!rres.ok) return { statusCode: 500, body: JSON.stringify({ error: 'QBO refresh failed', detail: tok }) };
  await admin.from('integration_tokens').upsert({
    id: 'qbo',
    data: { refresh_token: tok.refresh_token, realm_id: tokRow.data.realm_id },
    updated_at: new Date().toISOString(),
  });
  const access = tok.access_token, realm = tokRow.data.realm_id;

  const rules = (process.env.QBO_CHANNEL_MAP || 'ingredient=ingredients;royalt=royalty')
    .split(';').map(s => s.trim()).filter(Boolean)
    .map(s => { const [match, channel] = s.split('='); return { match: match.toLowerCase(), channel }; });

  const { data: corp } = await admin.from('corporations').select('id').eq('code', 'HQ').maybeSingle();
  const { data: channels } = await admin.from('revenue_channels').select('id,code').eq('corporation_id', corp.id);
  const chId = {}; (channels || []).forEach(c => chId[c.code] = c.id);

  const dates = [1, 2].map(back => {
    const d = new Date(); d.setDate(d.getDate() - back);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  const query = async (q) => {
    const res = await fetch(`${QBO_API}/v3/company/${realm}/query?query=${encodeURIComponent(q)}&minorversion=73`,
      { headers: { Authorization: 'Bearer ' + access, Accept: 'application/json' } });
    if (!res.ok) throw new Error('QBO query failed: ' + res.status);
    return (await res.json()).QueryResponse || {};
  };

  const log = [];
  for (const date of dates) {
    const sums = { ingredients: 0, royalty: 0, other_rev: 0 };
    try {
      const [inv, sr] = await Promise.all([
        query(`SELECT * FROM Invoice WHERE TxnDate = '${date}'`),
        query(`SELECT * FROM SalesReceipt WHERE TxnDate = '${date}'`),
      ]);
      for (const doc of [...(inv.Invoice || []), ...(sr.SalesReceipt || [])]) {
        for (const line of doc.Line || []) {
          if (line.DetailType !== 'SalesItemLineDetail') continue;
          const item = line.SalesItemLineDetail && line.SalesItemLineDetail.ItemRef;
          sums[channelFor(item && item.name, rules)] += Number(line.Amount || 0);
        }
      }
    } catch (e) { log.push(date + ': ' + e.message); continue; }

    for (const [ch, amount] of Object.entries(sums)) {
      if (!chId[ch]) continue;
      const { data: existing } = await admin.from('daily_revenue').select('id,source')
        .eq('corporation_id', corp.id).eq('channel_id', chId[ch]).eq('date', date).maybeSingle();
      if (existing && existing.source === 'manual') continue;
      await admin.from('daily_revenue').upsert({
        corporation_id: corp.id, channel_id: chId[ch], date,
        amount: +amount.toFixed(2), source: 'quickbooks', updated_at: new Date().toISOString(),
      }, { onConflict: 'corporation_id,channel_id,date' });
    }
    log.push(date + ': ok');
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, log }) };
};
