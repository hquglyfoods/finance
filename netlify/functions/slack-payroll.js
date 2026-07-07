// netlify/functions/slack-payroll.js
// Payroll entry driven by the #payroll-corporate channel.
//
// Flow:
//   1. Maria posts, per store, an Excel screenshot + the ADP screenshot she used
//      to enter that store's payroll. ADP "Gross Pay" total = Payroll + Payroll Tax.
//   2. Chi reviews and replies "payroll looks good" / "confirm" / "approved".
//   3. On Chi's confirmation, this bot reads the recent ADP screenshots in the
//      channel, extracts each store's Payroll and Payroll Tax, and books them as
//      PENDING expenses dated the previous week's Sunday:
//        - Payroll      -> 'payroll' category (labor)
//        - Payroll Tax  -> 'payroll_tax' category
//   4. The owner approves them in the app's Approvals screen.
//
// Only Chi's confirmation makes the data official; nothing is booked before it.
//
// Slack setup:
//   Event Subscriptions request URL -> this function
//   Subscribe to bot event: message.channels
//   Bot scopes: channels:history, channels:read, files:read, chat:write
//   Invite the bot to #payroll-corporate.
//
// Env vars:
//   SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, ANTHROPIC_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   PAYROLL_CHANNEL_ID        the #payroll-corporate channel id
//   PAYROLL_CONFIRMERS        (optional) comma list of Slack user ids allowed to
//                             confirm; if unset, any non-bot human confirms.
//   PAYROLL_STORE_CODES       (optional) store codes to consider, default "AD,BW,FH"

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function verifySlack(event) {
  const ts = event.headers['x-slack-request-timestamp'];
  const sig = event.headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const base = `v0:${ts}:${event.body}`;
  const mine = 'v0=' + crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update(base).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig)); } catch { return false; }
}

const CONFIRM_RE = /\b(payroll\s+(looks?\s+good|is\s+good|good|ok|okay|approved|confirmed?)|looks?\s+good|confirm(ed)?|approved?|✅)\b/i;

function isConfirmation(text) {
  if (!text) return false;
  return CONFIRM_RE.test(text.trim());
}

// Previous week's Sunday (the Sunday before the most recent Sunday's week).
// Payroll for the prior week is confirmed Mon/Tue, paid Wed, but booked to the
// Sunday that ended that prior work week.
function priorWeekSunday(now) {
  const d = new Date(now);
  const dow = d.getDay();                 // 0=Sun
  // most recent Sunday (start of current week)
  d.setDate(d.getDate() - dow);
  // step back one more week to the Sunday that ended the prior work week
  d.setDate(d.getDate() - 7);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function slackHistory(channel, limit = 40) {
  const res = await fetch(`https://slack.com/api/conversations.history?channel=${channel}&limit=${limit}`, {
    headers: { Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN },
  });
  const j = await res.json();
  return j.ok ? (j.messages || []) : [];
}

async function downloadImage(url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN } });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || 'image/jpeg';
  if (!ct.startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 4_500_000) return null;
  return { media_type: ct.split(';')[0], data: buf.toString('base64') };
}

async function postSlack(channel, text) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN },
    body: JSON.stringify({ channel, text }),
  });
}

// Ask Claude to read the ADP screenshots and return per-store payroll + tax.
async function parsePayroll(images, storeCodes) {
  const content = [];
  content.push({ type: 'text', text:
    `You are reading screenshots from a restaurant company's payroll channel. ` +
    `Only some of these images are ADP payroll screens. Others may be Excel bonus ` +
    `tables, attendance sheets, or other summaries.\n\n` +
    `Store codes in this company: ${storeCodes.join(', ')} ` +
    `(AD = American Dream, BW = Bushwick, FH = Forest Hills).\n\n` +
    `CRITICAL - what counts as payroll:\n` +
    `- ONLY extract numbers from actual ADP payroll screens. An ADP screen shows a ` +
    `payroll run with columns like Type, Total hours, Gross pay, Taxes, Deductions, ` +
    `Net pay, and totals such as "Gross Pay" and "Cash required", plus a check date / ` +
    `pay period.\n` +
    `- Bonuses are already INCLUDED in the ADP Gross Pay total (they are entered into ` +
    `ADP before the run), so do NOT add them separately.\n` +
    `- IGNORE any bonus tables, "perfect attendance" tables, Refunds/Bonus columns, ` +
    `Excel spreadsheets, or attendance sheets. These are supporting documents, NOT ` +
    `payroll, and their numbers must never be extracted or added. If an image is not ` +
    `clearly an ADP payroll screen, skip it entirely.\n\n` +
    `On an ADP screen, the "Gross Pay" total equals Payroll (wages) PLUS Payroll Tax. ` +
    `For each store you can identify FROM AN ADP SCREEN, extract:\n` +
    `  - payroll: the wages amount (Gross Pay total minus payroll tax), and\n` +
    `  - payroll_tax: the employer payroll tax amount.\n` +
    `If a screen shows Gross Pay total and a separate tax figure, compute payroll = gross_total - payroll_tax. ` +
    `If only a single wages figure is shown with no tax, set payroll to that and payroll_tax to 0.\n\n` +
    `Match each ADP screen to a store using any store name, address, or label visible. ` +
    `If you cannot tell which store, use "UNKNOWN".\n\n` +
    `Respond with ONLY a JSON array, no markdown, no prose. Include ONE object per ADP ` +
    `payroll screen only (no objects for bonus/attendance/Excel images):\n` +
    `[{"store":"AD","payroll":<number>,"payroll_tax":<number>,"gross":<number>,"confident":<true|false>}]\n` +
    `Numbers only, no currency symbols or commas. If no ADP payroll screen is present, return [].`
  });
  for (const img of images) content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 800, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error('Claude API ' + res.status);
  const data = await res.json();
  const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const clean = txt.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  if (body.type === 'url_verification') return { statusCode: 200, body: body.challenge };
  if (!verifySlack(event)) return { statusCode: 403, body: 'Bad signature' };
  if (body.type !== 'event_callback') return { statusCode: 200, body: 'ignored' };

  const ev = body.event || {};
  if (ev.type !== 'message' || ev.bot_id) return { statusCode: 200, body: 'ignored' };
  if (ev.subtype && ev.subtype !== 'file_share') return { statusCode: 200, body: 'ignored' };

  const channel = (process.env.PAYROLL_CHANNEL_ID || '').trim();
  if (!channel || ev.channel !== channel) return { statusCode: 200, body: 'not payroll channel' };

  // must be a confirmation from an allowed confirmer
  if (!isConfirmation(ev.text)) return { statusCode: 200, body: 'not a confirmation' };
  const allow = (process.env.PAYROLL_CONFIRMERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(ev.user)) return { statusCode: 200, body: 'not an approved confirmer' };

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const storeCodes = (process.env.PAYROLL_STORE_CODES || 'AD,BW,FH').split(',').map(s => s.trim());

  // Idempotency: if we already handled a confirm very recently, skip (Slack retries).
  // Use the confirm message ts as a natural key stored in a memo tag.
  const confirmTs = ev.ts;

  // Gather ADP/Excel images posted before this confirmation (same channel, not threaded).
  const history = await slackHistory(channel, 200);
  const confirmTime = Number(ev.ts);
  const cutoff = confirmTime - 48 * 3600; // look back up to 48h (payroll is usually confirmed 24-36h after the ADP screenshots are posted)
  const imgFiles = [];
  for (const msg of history) {
    const t = Number(msg.ts);
    if (t >= confirmTime || t < cutoff) continue;
    if (msg.bot_id) continue;
    for (const f of (msg.files || [])) {
      if (f.mimetype && f.mimetype.startsWith('image/') && f.url_private_download) imgFiles.push(f.url_private_download);
    }
  }
  if (!imgFiles.length) { await postSlack(channel, ':warning: I saw the confirmation but found no screenshots in the last 48 hours to read.'); return { statusCode: 200, body: 'no images' }; }

  const images = [];
  for (const url of imgFiles.slice(0, 15)) { const img = await downloadImage(url); if (img) images.push(img); }
  if (!images.length) return { statusCode: 200, body: 'no downloadable images' };

  let parsed;
  try { parsed = await parsePayroll(images, storeCodes); }
  catch (e) { await postSlack(channel, ':warning: I could not read the payroll screenshots automatically. Please enter payroll manually this week.'); return { statusCode: 200, body: 'parse failed' }; }
  if (!Array.isArray(parsed)) parsed = [];

  const date = priorWeekSunday(new Date());

  // resolve corp + category ids
  const { data: corps } = await admin.from('corporations').select('id,code').in('code', storeCodes);
  const corpByCode = {}; (corps || []).forEach(c => corpByCode[c.code] = c.id);
  const corpIds = (corps || []).map(c => c.id);
  const { data: cats } = await admin.from('expense_categories').select('id,corporation_id,code')
    .in('corporation_id', corpIds).in('code', ['payroll', 'payroll_tax']);
  const catBy = {}; (cats || []).forEach(c => { catBy[c.corporation_id + '|' + c.code] = c.id; });

  const rows = [];
  const summary = [];
  for (const p of parsed) {
    const corpId = corpByCode[p.store];
    if (!corpId) continue;
    const payroll = Number(p.payroll) || 0;
    const tax = Number(p.payroll_tax) || 0;
    if (payroll > 0 && catBy[corpId + '|payroll']) {
      rows.push({ corporation_id: corpId, category_id: catBy[corpId + '|payroll'], date, amount: payroll,
        memo: `Payroll (ADP, confirmed) wk ending ${date}`, source: 'payroll_bot', status: 'pending', slack_ts: `pr_${confirmTs}_${p.store}_p` });
    }
    if (tax > 0 && catBy[corpId + '|payroll_tax']) {
      rows.push({ corporation_id: corpId, category_id: catBy[corpId + '|payroll_tax'], date, amount: tax,
        memo: `Payroll tax (ADP, confirmed) wk ending ${date}`, source: 'payroll_bot', status: 'pending', slack_ts: `pr_${confirmTs}_${p.store}_t` });
    }
    summary.push(`${p.store}: payroll $${payroll.toLocaleString()} · tax $${tax.toLocaleString()}`);
  }

  if (!rows.length) {
    // Explain WHY nothing matched so it's fixable without digging through logs.
    const parsedNote = Array.isArray(parsed) && parsed.length
      ? parsed.map(p => `${p.store||'?'}: payroll ${p.payroll==null?'-':'$'+p.payroll}, tax ${p.payroll_tax==null?'-':'$'+p.payroll_tax}${p.confident===false?' (low confidence)':''}`).join('; ')
      : '(the reader returned nothing usable)';
    const knownStores = Object.keys(corpByCode).join(', ') || '(none found in DB)';
    await postSlack(channel,
      `:warning: I read ${images.length} image${images.length===1?'':'s'} but could not book any store payroll.\n` +
      `What I extracted: ${parsedNote}\n` +
      `Stores I can match: ${knownStores}. ` +
      `Make sure the ADP screenshots for each store were posted in the last 6 hours and show the store name/address, then re-confirm. Or enter payroll manually.`);
    return { statusCode: 200, body: 'no rows' };
  }

  // insert (dedup on slack_ts unique index prevents double-posting on Slack retries)
  const { error } = await admin.from('expenses').insert(rows);
  if (error && !String(error.message).includes('duplicate')) {
    await postSlack(channel, ':warning: Saving payroll failed: ' + error.message);
    return { statusCode: 200, body: 'insert error' };
  }

  await postSlack(channel,
    `:white_check_mark: Payroll captured for week ending *${date}* and sent to approvals:\n` +
    summary.map(s => '• ' + s).join('\n') +
    `\nThe owner will confirm these in the finance app.`);

  // notify owner via push (best effort)
  try {
    await fetch(`${process.env.URL || ''}/.netlify/functions/push-notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner', title: 'Payroll ready to approve', body: `Week ending ${date} · ${summary.length} store(s)` }),
    });
  } catch {}

  return { statusCode: 200, body: JSON.stringify({ ok: true, date, stores: summary.length, rows: rows.length }) };
};
