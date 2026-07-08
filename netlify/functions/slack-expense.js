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
const { Jimp } = require('jimp');

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

// Anthropic's API rejects images whose base64 payload exceeds 5MB. base64 inflates the
// raw bytes by ~33%, so we keep the RAW download under ~3.6MB (about 4.8MB base64) when
// using an image as-is. Slack's auto-thumbnails are almost always well under this.
const MAX_RAW_BYTES = 3_600_000;

// Fetch raw bytes (no size cap) plus content-type. Used both for small images we pass
// through and for large originals we resize before sending.
async function fetchBytes(url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN } });
  if (!res.ok) { console.log('SLACK_IMG_HTTP', res.status, url.slice(0, 80)); return null; }
  const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  return { ct, buf };
}

// Downscale any Jimp-readable image (jpeg/png/gif/bmp/tiff) to fit comfortably under the
// API limit: cap the long edge at 1600px and encode JPEG at quality 80. Returns a
// ready-to-send {media_type,data} or null if the bytes can't be decoded (e.g. HEIC).
async function resizeToFit(buf) {
  try {
    const img = await Jimp.read(buf);
    const w = img.bitmap.width, h = img.bitmap.height;
    const longEdge = Math.max(w, h);
    if (longEdge > 1600) {
      if (w >= h) img.resize({ w: 1600 }); else img.resize({ h: 1600 });
    }
    let quality = 80;
    let out = await img.getBuffer('image/jpeg', { quality });
    // If still too big, step the quality down until it fits (rare for receipts).
    while (out.length > MAX_RAW_BYTES && quality > 40) {
      quality -= 15;
      out = await img.getBuffer('image/jpeg', { quality });
    }
    if (out.length > MAX_RAW_BYTES) { console.log('SLACK_IMG_RESIZE_STILL_BIG', out.length); return null; }
    console.log('SLACK_IMG_RESIZED', w + 'x' + h, '->', img.bitmap.width + 'x' + img.bitmap.height, out.length + 'B', 'q' + quality);
    return { media_type: 'image/jpeg', data: out.toString('base64') };
  } catch (e) {
    console.log('SLACK_IMG_RESIZE_FAILED', e.message);
    return null;
  }
}

// Turn one downloaded blob into an API-ready image: pass it through if it's already a
// small, Claude-supported type; otherwise resize/re-encode it with Jimp.
async function toApiImage(ct, buf) {
  const supported = /^image\/(jpeg|png|gif|webp)$/.test(ct);
  if (supported && buf.length <= MAX_RAW_BYTES) {
    return { media_type: ct, data: buf.toString('base64') };
  }
  // Too big, or a type Claude won't take (or that Jimp can re-encode). Resize it.
  // (webp/heic that Jimp can't decode will return null and we move to the next candidate.)
  return await resizeToFit(buf);
}

// iPhone/Android photos are often 5-12MB. Slack auto-generates smaller JPEG thumbnails;
// try those first (largest first). If a thumbnail is missing or itself too big, fall back
// to the original and RESIZE it locally so a large photo still gets through. First success
// wins.
async function collectImage(f) {
  const candidates = [
    f.thumb_1024, f.thumb_960, f.thumb_800, f.thumb_720, f.thumb_640, f.thumb_480,
    f.url_private_download, f.url_private,
  ].filter(Boolean);
  console.log('SLACK_IMG_TRY', JSON.stringify({
    id: f.id, filetype: f.filetype, mimetype: f.mimetype, size: f.size, candidates: candidates.length,
  }));
  for (const url of candidates) {
    const got = await fetchBytes(url);
    if (!got) continue;
    if (!got.ct.startsWith('image/')) { console.log('SLACK_IMG_NOT_IMAGE', got.ct, url.slice(0, 80)); continue; }
    const img = await toApiImage(got.ct, got.buf);
    if (img) return img;
  }
  console.log('SLACK_IMG_DOWNLOAD_FAILED', f.id, f.filetype, f.size, 'tried:', candidates.length);
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
  if (!res.ok) { const errBody = await res.text().catch(()=> ''); throw new Error('Claude API ' + res.status + ' ' + errBody.slice(0, 200)); }
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
  // Diagnostic: log every incoming message event's shape so we can see why photo-only
  // posts might get dropped (subtype, whether files are attached, etc.).
  console.log('SLACK_EVENT', JSON.stringify({
    type: ev.type, subtype: ev.subtype || null, bot_id: ev.bot_id || null,
    channel: ev.channel, has_text: !!(ev.text && ev.text.trim()),
    file_count: (ev.files || []).length, ts: ev.ts,
  }));
  if (ev.type !== 'message' || ev.bot_id) return { statusCode: 200, body: 'ignored' };
  // Accept plain messages and file shares. A photo-only post can arrive with subtype
  // 'file_share' OR (in some clients) with no subtype but a populated files array, so we
  // only bail on subtypes that are clearly not user expense posts AND carry no files.
  if (ev.subtype && ev.subtype !== 'file_share' && !(ev.files && ev.files.length)) {
    console.log('SLACK_SKIP_SUBTYPE', ev.subtype);
    return { statusCode: 200, body: 'ignored subtype' };
  }

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
  catch (e) { console.log('SLACK_PARSE_FAILED', e.message, 'images:', images.length); return { statusCode: 200, body: 'parse failed: ' + e.message }; }

  // Diagnostic: log exactly what Claude returned. A photo that produces no expense is
  // dropped by one of the guards below; this line shows WHICH result caused it (classified
  // as non-expense vs no readable amount) instead of the message vanishing silently.
  console.log('SLACK_PARSED', JSON.stringify({
    not_an_expense: parsed.not_an_expense === true,
    amount: Number(parsed.amount || 0),
    category: parsed.category || null,
    confident: parsed.confident === true,
    summary: (parsed.summary || '').slice(0, 120),
    images: images.length,
  }));

  // Non-expense messages (coin box / cash count reports, sales/deposit reports,
  // attendance notes) must NOT be booked as expenses.
  if (parsed.not_an_expense === true || (Number(parsed.amount || 0) === 0 && parsed.confident === false && !images.length)) {
    console.log('SLACK_SKIP_NOT_EXPENSE', JSON.stringify({ not_an_expense: parsed.not_an_expense === true, amount: Number(parsed.amount || 0), confident: parsed.confident === true, images: images.length }));
    return { statusCode: 200, body: 'not an expense, skipped' };
  }

  const amount = Number(parsed.amount || 0);
  if (amount <= 0) {
    console.log('SLACK_SKIP_ZERO_AMOUNT', JSON.stringify({ amount, confident: parsed.confident === true, images: images.length, summary: (parsed.summary || '').slice(0, 80) }));
    return { statusCode: 200, body: 'no positive amount, skipped' };
  }

  // Amount-window dedup. An employee sometimes posts the receipt PHOTO and then, in a
  // SEPARATE message, the same purchase as text. Those are two different Slack messages
  // (different slack_ts), so the exact-ts dedup near the top can't catch them. Rule: a new
  // expense is a duplicate when the SAME store already has a Slack expense of the SAME
  // amount (to the cent) within 12 hours. The window is measured on real event time via
  // slack_ts, so it also catches a re-post that crosses midnight. Tradeoff (accepted): two
  // genuinely separate purchases of the identical amount at one store within 12h will be
  // treated as one; the skip is logged so it can be added manually if that ever happens.
  const DEDUP_WINDOW_SECS = 12 * 3600;
  const evSec = Number(ev.ts);
  const centAmount = +amount.toFixed(2);
  const { data: sameAmt } = await admin.from('expenses')
    .select('id, slack_ts, date')
    .eq('corporation_id', corp.id).eq('source', 'slack').eq('amount', centAmount)
    .order('slack_ts', { ascending: false }).limit(25);
  const dupWin = (sameAmt || []).find(r => r.slack_ts
    && Number.isFinite(Number(r.slack_ts))
    && Math.abs(evSec - Number(r.slack_ts)) <= DEDUP_WINDOW_SECS);
  if (dupWin) {
    console.log('SLACK_DUP_AMOUNT_WINDOW', JSON.stringify({ amount: centAmount, corp: corpCode, matched_id: dupWin.id, matched_ts: dupWin.slack_ts, new_ts: ev.ts }));
    return { statusCode: 200, body: 'duplicate amount within 12h, skipped' };
  }

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

  // Auto-approval mode is owner-controlled from the app (Settings > Slack) and stored in
  // app_settings. Default 'off' so that during rollout EVERY Slack expense lands as
  // pending for manual approval (and fires the pending push). The owner flips this to
  // 'semi' or 'full' once they trust the capture.
  //   off  -> never auto-confirm; everything pending
  //   semi -> auto-confirm only when confident AND it matches a past approval (learning)
  //   full -> auto-confirm whenever confident; only unreadable/low-confidence stay pending
  const { data: modeRow } = await admin.from('app_settings').select('value').eq('key', 'slack_autoapprove_mode').maybeSingle();
  const autoMode = ((modeRow && modeRow.value) || 'off').toLowerCase();

  const familiar = parsed.confident === true
    && matchesLearning(parsed.summary, cat.code, cat.name, learnings || []);
  let autoApprove = false;
  if (autoMode === 'full') autoApprove = parsed.confident === true;
  else if (autoMode === 'semi') autoApprove = familiar;
  // 'off' or any unrecognized value: never auto-approve.
  const status = autoApprove ? 'confirmed' : 'pending';
  if (autoApprove) memoBits.push(autoMode === 'full'
    ? '[auto-approved: full mode]'
    : '[auto-approved: matches a past approval]');
  console.log('SLACK_AUTOMODE', JSON.stringify({ mode: autoMode, familiar, autoApprove, status }));

  const { error: insErr } = await admin.from('expenses').insert({
    corporation_id: corp.id, category_id: cat.id, date: iso,
    amount: +amount.toFixed(2), memo: memoBits.join(' ').slice(0, 300),
    source: 'slack', status, method: 'cash',
    slack_ts: ev.ts, slack_user: ev.user || null,
  });
  // A Supabase database webhook on expenses INSERT (status=pending) fires
  // push-notify to owner/assistant. No direct call needed here.
  if (insErr) { console.log('SLACK_INSERT_FAILED', insErr.message || String(insErr)); return { statusCode: 200, body: 'insert failed: ' + (insErr.message || '') }; }
  console.log('SLACK_INSERTED', JSON.stringify({ amount: +amount.toFixed(2), category: cat.name, status, date: iso }));

  return { statusCode: 200, body: familiar ? 'ok (auto-confirmed)' : 'ok (pending)' };
};
