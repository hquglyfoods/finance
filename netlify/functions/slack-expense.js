// netlify/functions/slack-expense.js
// Slack Events API endpoint. Employees post cash purchases in the expense
// channel; each message becomes a PENDING expense that Maria approves in the app.
//
// Message format (flexible): must contain a store code and an amount.
//   "AD ingredients cash $45.20"
//   "BW coin change $100"
//   "FH 재료 $32"
// Store code: AD / BW / FH / HQ / UMMA anywhere in the message.
// Amount: first $ number (or bare number) in the message.
//
// Slack app setup:
//   1. api.slack.com/apps -> Create App -> Event Subscriptions ON
//   2. Request URL: {SITE}/.netlify/functions/slack-expense (auto-verified)
//   3. Subscribe to bot event: message.channels, invite the bot to the channel
//   4. Env vars: SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID
//      (plus SUPABASE_URL, SUPABASE_SERVICE_KEY)

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const CORP_CODES = ['AD', 'BW', 'FH', 'HQ', 'UMMA'];
const CATEGORY_HINTS = [
  { match: /supply|supplies|ingredient|재료|food/i, code: ['supplies', 'supplies_food'] },
  { match: /coin|change|동전/i, code: ['others'] },
];

function verifySlack(event) {
  const ts = event.headers['x-slack-request-timestamp'];
  const sig = event.headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay guard
  const base = `v0:${ts}:${event.body}`;
  const mine = 'v0=' + crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(base).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig)); }
  catch { return false; }
}

function parseMessage(text) {
  const upper = ' ' + text.toUpperCase() + ' ';
  const corp = CORP_CODES.find(c => upper.includes(' ' + c + ' ') || upper.includes(' ' + c + ':'))
    || CORP_CODES.find(c => upper.includes(c));
  const amt = text.match(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/) || text.match(/([0-9][0-9,]*\.\d{2})/)
    || text.match(/\b([0-9][0-9,]{1,8})\b/);
  const amount = amt ? parseFloat(amt[1].replace(/,/g, '')) : null;
  return { corp, amount };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  // Slack URL verification handshake
  if (body.type === 'url_verification')
    return { statusCode: 200, body: body.challenge };

  if (!verifySlack(event)) return { statusCode: 403, body: 'Bad signature' };
  if (body.type !== 'event_callback') return { statusCode: 200, body: 'ignored' };

  const ev = body.event || {};
  if (ev.type !== 'message' || ev.subtype || ev.bot_id) return { statusCode: 200, body: 'ignored' };
  if (process.env.SLACK_CHANNEL_ID && ev.channel !== process.env.SLACK_CHANNEL_ID)
    return { statusCode: 200, body: 'ignored' };

  const { corp, amount } = parseMessage(ev.text || '');
  if (!corp || !amount) return { statusCode: 200, body: 'unparseable' };

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });

  const { data: c } = await admin.from('corporations').select('id').eq('code', corp).maybeSingle();
  if (!c) return { statusCode: 200, body: 'unknown corp' };

  const { data: cats } = await admin.from('expense_categories')
    .select('id,code').eq('corporation_id', c.id);
  let catId = null;
  for (const hint of CATEGORY_HINTS) {
    if (hint.match.test(ev.text || '')) {
      const found = (cats || []).find(x => hint.code.includes(x.code));
      if (found) { catId = found.id; break; }
    }
  }
  if (!catId) {
    const others = (cats || []).find(x => x.code === 'others');
    catId = others && others.id;
  }
  if (!catId) return { statusCode: 200, body: 'no category' };

  const date = new Date(Number(ev.ts) * 1000);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  // slack_ts unique index makes duplicate deliveries harmless
  await admin.from('expenses').insert({
    corporation_id: c.id, category_id: catId, date: iso,
    amount, memo: (ev.text || '').slice(0, 300),
    source: 'slack', status: 'pending',
    slack_ts: ev.ts, slack_user: ev.user || null,
  });

  return { statusCode: 200, body: 'ok' };
};
