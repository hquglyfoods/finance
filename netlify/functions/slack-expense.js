// netlify/functions/slack-expense.js
// Slack Events API endpoint for the per-store expense channels:
//   expense-americandream -> AD, expense-bushwick -> BW, expense-foresthills -> FH
// The store is decided by WHICH channel the message is in (not the text).
//
// Each message (free-form text and/or receipt photos) is parsed by Claude into
// a single expense: total amount, best-guess category, and a concise summary.
// Result is inserted as PENDING for Maria to approve in the app.
//
// Receipt photos: a message may contain TWO images of the same purchase (the
// store receipt AND a POS cash-out receipt). Claude is instructed to count the
// purchase only once.
//
// Slack app setup:
//   Event Subscriptions ON, Request URL = {SITE}/.netlify/functions/slack-expense
//   Subscribe to bot event: message.channels
//   Bot scopes: channels:history, channels:read, files:read
//   Invite the bot to each expense-* channel.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN
//   ANTHROPIC_API_KEY
//   SLACK_CHANNEL_MAP  "C123=AD,C456=BW,C789=FH"  (channel id -> corp code)

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

function channelMap() {
  const m = {};
  (process.env.SLACK_CHANNEL_MAP || '').split(',').map(s => s.trim()).filter(Boolean)
    .forEach(pair => { const [cid, code] = pair.split('='); if (cid && code) m[cid.trim()] = code.trim(); });
  return m;
}

// Normalize a description into a "signal" the same way the app does when it records a
// learning on approve, so we can compare a new expense to past approvals.
function toSignal(s) {
  return (s || '').toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, 80);
}

// Is this expense "familiar"? True when a past approval used the same (or clearly
// overlapping) signal AND landed on the same category we're about to file it under.
// That means the owner has confirmed this kind of expense before.
const STOP_WORDS = new Set(['from','with','and','the','for','store','purchase','receipt','paid','cash','out','payment','bill','total','order','items','item']);
function matchesLearning(summary, categoryCode, categoryName, learnings) {
  const sig = toSignal(summary);
  if (sig.length < 3) return false;
  const words = sig.split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  const wordSet = new Set(words);
  for (const l of (learnings || [])) {
    const lsig = toSignal(l.signal);
    if (!lsig) continue;
    const sameCat = (l.category_code && categoryCode && l.category_code === categoryCode)
      || (l.category_name && categoryName && l.category_name === categoryName);
    if (!sameCat) continue;
    // exact signal match, or one fully contains the other
    if (lsig === sig || lsig.includes(sig) || sig.includes(lsig)) return true;
    // otherwise require at least TWO shared distinctive (non-stopword) words, so a
    // single common word like "from" can't trigger a false auto-approval.
    const lwords = new Set(lsig.split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w)));
    let shared = 0;
    for (const w of wordSet) if (lwords.has(w)) shared++;
    if (shared >= 2) return true;
  }
  return false;
}

async function downloadImage(url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN } });
  if (!res.ok) { console.log('SLACK_IMG_HTTP', res.status, url.slice(0, 80)); return null; }
  const ct = res.headers.get('content-type') || 'image/jpeg';
  if (!ct.startsWith('image/')) { console.log('SLACK_IMG_NOT_IMAGE', ct); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 4_500_000) { console.log('SLACK_IMG_TOO_BIG', buf.length); return null; }
  return { media_type: ct.split(';')[0], data: buf.toString('base64') };
}

// iPhone photos are often 5-10MB, which blows past our size cap, so the full-resolution
// url_private_download gets dropped. Slack auto-generates smaller thumbnails; try those
// first (largest first) and only fall back to the full file. First success wins.
async function collectImage(f) {
  const candidates = [
    f.thumb_1024, f.thumb_960, f.thumb_800, f.thumb_720,
    f.url_private_download, f.url_private,
  ].filter(Boolean);
  for (const url of candidates) {
    const img = await downloadImage(url);
    if (img) return img;
  }
  console.log('SLACK_IMG_DOWNLOAD_FAILED', f.id, f.filetype, f.size, 'candidates:', candidates.length);
  return null;
}

async function parseWithClaude(text, images, categories, learnings) {
  const catList = categories.map(c => c.name).join(', ');
  const examples = (learnings || []).slice(0, 25)
    .map(l => `- "${l.signal}" -> ${l.category_name}`).join('\n');
  const content = [];
  content.push({ type: 'text', text:
    `You are logging a store expense from a Slack message in a restaurant's expense channel. ` +
    `The message may contain free-form text listing items and prices, and/or one or more receipt photos.\n\n` +
    `IMPORTANT about photos: a message may include TWO images of the SAME purchase, ` +
    `for example the store's purchase receipt AND a POS "cash out / paid out" slip recording that the cash left the register. ` +
    `These represent ONE expense. Do NOT add them twice. Use the single purchase total.\n\n` +
    `Also ignore lines that are just a cashier signature or name (e.g. "Closing Cashier ~Mariana", "(Victor)").\n\n` +
    `NOT EVERY MESSAGE IS AN EXPENSE. Some messages are cash-handling or bookkeeping reports, NOT money spent. ` +
    `In particular, a "Coin Box Report" / "Coin exchange" / cash drawer or register count (listing counts of ` +
    `Singles, Fives, Quarters, Dimes, Nickels, Pennies, Dollar bills, etc. with a TOTAL) is just reporting cash on ` +
    `hand, not a purchase. Sales reports, deposit reports, tip declarations, and attendance notes are also not expenses. ` +
    `For any message like these, set "not_an_expense" to true and amount to 0. Only treat a message as an expense when ` +
    `it clearly records money the store SPENT (a purchase, bill, or cash paid out with a receipt or vendor).\n\n` +
    `Available expense categories: ${catList}.\n\n` +
    (examples ? `Here is how this store's expenses were categorized by staff in the past. Follow these patterns when they apply:\n${examples}\n\n` : '') +
    (text ? `Message text:\n"""${text}"""\n\n` : `The message has no text, only image(s).\n\n`) +
    `Respond with ONLY a JSON object, no markdown, no prose:\n` +
    `{"not_an_expense": <true|false>, "amount": <number, total of the single purchase>, "category": "<one of the categories above, best guess>", ` +
    `"summary": "<short description of what was bought, under 120 chars>", "confident": <true|false>}\n` +
    `If the message is not an expense (e.g. a coin box / cash count report), set not_an_expense to true and amount to 0. ` +
    `If you cannot determine an amount, set amount to 0 and confident to false.`
  });
  for (const img of images) content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 400, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error('Claude API ' + res.status);
  const data = await res.json();
  const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const clean = txt.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  // Ignore Slack retries (same event re-sent when our slow work delays the ack) so we
  // don't process/reply to the same message more than once.
  const h = event.headers || {};
  if (h['x-slack-retry-num'] || h['X-Slack-Retry-Num']) return { statusCode: 200, body: 'ignored retry' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  if (body.type === 'url_verification') return { statusCode: 200, body: body.challenge };
  if (!verifySlack(event)) return { statusCode: 403, body: 'Bad signature' };
  if (body.type !== 'event_callback') return { statusCode: 200, body: 'ignored' };

  // ACK fast; Slack retries if we take too long. We do the work inline but keep it lean.
  const ev = body.event || {};
  if (ev.type !== 'message' || ev.bot_id) return { statusCode: 200, body: 'ignored' };
  if (ev.subtype && ev.subtype !== 'file_share') return { statusCode: 200, body: 'ignored' };

  const map = channelMap();
  const corpCode = map[ev.channel];
  if (!corpCode) return { statusCode: 200, body: 'channel not mapped' };

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // dedupe by slack ts (unique index also enforces this)
  const { data: dupe } = await admin.from('expenses').select('id').eq('slack_ts', ev.ts).maybeSingle();
  if (dupe) return { statusCode: 200, body: 'duplicate' };

  const { data: corp } = await admin.from('corporations').select('id').eq('code', corpCode).maybeSingle();
  if (!corp) return { statusCode: 200, body: 'unknown corp' };
  const { data: cats } = await admin.from('expense_categories').select('id,code,name')
    .eq('corporation_id', corp.id).eq('active', true).order('display_order');

  // recent human corrections for this store, to teach Claude
  const { data: learnings } = await admin.from('slack_learnings')
    .select('signal, category_name, category_code').eq('corporation_id', corp.id)
    .order('created_at', { ascending: false }).limit(40);

  // collect up to 3 images. iPhone photos can be large, so collectImage prefers Slack's
  // smaller auto-thumbnails and only falls back to the full file.
  const rawFiles = ev.files || [];
  console.log('SLACK_FILES', JSON.stringify(rawFiles.map(f => ({
    id: f.id, mimetype: f.mimetype, filetype: f.filetype, size: f.size,
    has_thumb: !!(f.thumb_1024 || f.thumb_960 || f.thumb_800), has_dl: !!f.url_private_download,
  }))));
  const images = [];
  for (const f of rawFiles.slice(0, 3)) {
    const isImage = (f.mimetype && f.mimetype.startsWith('image/')) ||
      ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'].includes((f.filetype || '').toLowerCase());
    if (!isImage) { console.log('SLACK_IMG_SKIP_NONIMAGE', f.mimetype, f.filetype); continue; }
    const img = await collectImage(f);
    if (img) images.push(img);
  }
  const text = (ev.text || '').trim();
  console.log('SLACK_PARSE_INPUT', JSON.stringify({ has_text: !!text, image_count: images.length }));
  if (!text && !images.length) return { statusCode: 200, body: 'nothing to parse' };

  let parsed;
  try { parsed = await parseWithClaude(text, images, cats || [], learnings || []); }
  catch (e) { return { statusCode: 200, body: 'parse failed: ' + e.message }; }

  // Non-expense messages (coin box / cash count reports, sales/deposit reports,
  // attendance notes) must NOT be booked as expenses.
  if (parsed.not_an_expense === true || (Number(parsed.amount || 0) === 0 && parsed.confident === false && !images.length)) {
    return { statusCode: 200, body: 'not an expense, skipped' };
  }

  const amount = Number(parsed.amount || 0);
  if (amount <= 0) return { statusCode: 200, body: 'no positive amount, skipped' };
  const cat = (cats || []).find(c => c.name === parsed.category)
    || (cats || []).find(c => c.code === 'others')
    || (cats || [])[0];
  if (!cat) return { statusCode: 200, body: 'no category' };

  // Expense date must be the STORE's local date, not the server's (Netlify runs in
  // UTC, so a message posted late evening in New York would otherwise book to the
  // next day). en-CA locale formats as YYYY-MM-DD.
  const tz = process.env.STORE_TIMEZONE || 'America/New_York';
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Number(ev.ts) * 1000));

  const memoBits = [];
  if (parsed.summary) memoBits.push(parsed.summary);
  if (!parsed.confident) memoBits.push('[low confidence, please verify]');
  if (images.length) memoBits.push(`(${images.length} receipt photo${images.length > 1 ? 's' : ''})`);

  // SEMI-AUTO: auto-confirm only when Claude is confident AND we've approved this kind
  // of expense before (same category as a past approval). Anything new or uncertain
  // stays pending for manual approval, which is also what trains the system.
  const familiar = parsed.confident === true
    && matchesLearning(parsed.summary, cat.code, cat.name, learnings || []);
  const status = familiar ? 'confirmed' : 'pending';
  if (familiar) memoBits.push('[auto-approved: matches a past approval]');

  await admin.from('expenses').insert({
    corporation_id: corp.id, category_id: cat.id, date: iso,
    amount: +amount.toFixed(2), memo: memoBits.join(' ').slice(0, 300),
    source: 'slack', status, method: 'cash',
    slack_ts: ev.ts, slack_user: ev.user || null,
  });
  // A Supabase database webhook on expenses INSERT (status=pending) fires
  // push-notify to owner/assistant. No direct call needed here.

  return { statusCode: 200, body: familiar ? 'ok (auto-confirmed)' : 'ok (pending)' };
};
