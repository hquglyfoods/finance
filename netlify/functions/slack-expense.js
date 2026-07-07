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
  if (!res.ok) { console.log('SLACK_IMG_HTTP', res.status); return null; }
  const ct = res.headers.get('content-type') || 'image/jpeg';
  if (!ct.startsWith('image/')) {
    // Slack returns an HTML page (not an image) when the bot token lacks files:read
    // or isn't in the channel. Surface that instead of silently dropping the photo.
    console.log('SLACK_IMG_NOT_IMAGE', ct);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 4_500_000) { console.log('SLACK_IMG_TOO_BIG', buf.length); return null; }
  return { media_type: ct.split(';')[0], data: buf.toString('base64') };
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
    `In particular, a "Coin Box Report" / cash drawer or register COUNT (listing counts of ` +
    `Singles, Fives, Quarters, Dimes, Nickels, Pennies, Dollar bills, etc. with a TOTAL) is just reporting cash on ` +
    `hand, not a purchase. Sales reports, deposit reports, tip declarations, and attendance notes are also not expenses. ` +
    `For any message like these, set "not_an_expense" to true and amount to 0.\n\n` +
    `HOWEVER, a "coin change" / "coin exchange" / "change for the register" where the store BUYS or exchanges bills for ` +
    `rolls of coins (cash actually leaves the store to get change) IS an expense: set not_an_expense to false, use the ` +
    `amount exchanged, and category "Coin Change" if it exists (otherwise the closest cash/others category). Do not confuse ` +
    `this with a coin box COUNT report. If the message clearly says money was exchanged/bought for change, it is an expense.\n\n` +
    `Only treat a message as an expense when it clearly records money the store SPENT (a purchase, bill, cash paid out, ` +
    `or coin change bought).\n\n` +
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
  let ev = body.event || {};
  // TEMP DIAGNOSTIC: log what Slack actually sends so we can see why photo-only posts
  // aren't recognized. Visible in Netlify function logs. Safe to remove later.
  try {
    console.log('SLACK_EVENT', JSON.stringify({
      type: ev.type, subtype: ev.subtype, channel: ev.channel,
      has_text: !!(ev.text && ev.text.trim()),
      files: Array.isArray(ev.files) ? ev.files.map(f => ({
        mimetype: f.mimetype, filetype: f.filetype,
        has_dl: !!f.url_private_download, has_priv: !!f.url_private,
      })) : null,
      top_level_type: body.event && body.event.type,
    }));
  } catch (_) {}
  if (ev.type !== 'message' || ev.bot_id) return { statusCode: 200, body: 'ignored' };

  // Handle EDITS: when an employee edits an earlier message (e.g. adds the amount they
  // forgot yesterday, or corrects it), Slack sends subtype 'message_changed' with the
  // real content in ev.message and the ORIGINAL timestamp in ev.message.ts. We re-parse
  // and UPDATE the existing expense for that ts instead of creating a new one.
  const isEdit = ev.subtype === 'message_changed';
  if (isEdit) {
    const inner = ev.message || {};
    if (inner.bot_id) return { statusCode: 200, body: 'ignored bot edit' };
    // rebuild an ev-like object from the edited message, keeping the channel
    ev = { ...inner, channel: ev.channel, type: 'message', subtype: inner.subtype };
  }
  // A deletion arrives as message_deleted; nothing to add, leave existing record as-is.
  if (ev.subtype === 'message_deleted') return { statusCode: 200, body: 'ignored deletion' };

  // Accept a normal message, OR any message that carries files (a photo-only upload
  // arrives as subtype 'file_share', but be lenient: if files are attached we handle it
  // regardless of subtype). Ignore joins/leaves/etc that carry no files.
  const hasFiles = Array.isArray(ev.files) && ev.files.length > 0;
  const okSubtype = !ev.subtype || ev.subtype === 'file_share';
  if (!okSubtype && !hasFiles) return { statusCode: 200, body: 'ignored' };

  const map = channelMap();
  const corpCode = map[ev.channel];
  if (!corpCode) return { statusCode: 200, body: 'channel not mapped' };

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // On an ORIGINAL post, dedupe by slack ts (also enforced by a unique index).
  // On an EDIT, we WANT to find the existing row (by its original ts) and update it.
  const existingByTs = ev.ts
    ? (await admin.from('expenses').select('id,status,category_id').eq('slack_ts', ev.ts).maybeSingle()).data
    : null;
  if (existingByTs && !isEdit) return { statusCode: 200, body: 'duplicate' };

  const { data: corp } = await admin.from('corporations').select('id').eq('code', corpCode).maybeSingle();
  if (!corp) return { statusCode: 200, body: 'unknown corp' };
  const { data: cats } = await admin.from('expense_categories').select('id,code,name')
    .eq('corporation_id', corp.id).eq('active', true).order('display_order');

  // recent human corrections for this store, to teach Claude
  const { data: learnings } = await admin.from('slack_learnings')
    .select('signal, category_name, category_code').eq('corporation_id', corp.id)
    .order('created_at', { ascending: false }).limit(40);

  // collect up to 3 images. Modern phone photos are often 5-10MB, which is too big for
  // us AND for the vision model. Slack auto-generates smaller thumbnails; prefer a
  // reasonably-sized thumbnail (still very readable for a receipt) and only fall back to
  // the full-resolution file when no thumbnail is available.
  const images = [];
  for (const f of (ev.files || []).slice(0, 3)) {
    const isImg = (f.mimetype && f.mimetype.startsWith('image/'))
      || (f.filetype && ['jpg','jpeg','png','heic','webp','gif'].includes(String(f.filetype).toLowerCase()));
    if (!isImg) continue;
    // Candidate URLs, largest-readable thumbnail first, full file last.
    const candidates = [f.thumb_1024, f.thumb_960, f.thumb_800, f.thumb_720, f.url_private_download, f.url_private].filter(Boolean);
    let got = null;
    for (const url of candidates) {
      got = await downloadImage(url);
      if (got) break;   // first one that downloads and fits wins
    }
    if (got) images.push(got);
    else console.log('SLACK_IMG_DOWNLOAD_FAILED', JSON.stringify({ mimetype: f.mimetype, filetype: f.filetype, tried: candidates.length }));
  }
  const text = (ev.text || '').trim();
  console.log('SLACK_PARSE_INPUT', JSON.stringify({ has_text: !!text, image_count: images.length, file_count: (ev.files || []).length }));
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
  const memo = memoBits.join(' ').slice(0, 300);

  // EDIT: the employee edited an earlier message. Update that same expense in place
  // (amount / category / memo) rather than creating a second one.
  if (isEdit && existingByTs) {
    await admin.from('expenses').update({
      category_id: cat.id, date: iso, amount: +amount.toFixed(2), memo,
    }).eq('id', existingByTs.id);
    return { statusCode: 200, body: 'edited existing expense' };
  }

  // SAME-DAY, SAME-AMOUNT DEDUP: an employee may post a receipt photo and, separately,
  // type the same expense (photo first or text first). If a Slack expense with the
  // EXACT same amount already exists for this store on the same local date, treat this
  // as the same purchase and skip it.
  // EXCEPTION: coin change (buying rolls of coins for the register) legitimately repeats
  // at the same amount several times a day, so it is never deduped by amount.
  const isCoinChange = /coin\s*change|coin\s*exchange|change for (the )?register|rolls? of coins/i.test(
    (parsed.summary || '') + ' ' + (cat.name || '') + ' ' + (cat.code || '')
  );
  if (!isCoinChange) {
    const { data: sameDay } = await admin.from('expenses')
      .select('id,amount')
      .eq('corporation_id', corp.id).eq('date', iso).eq('source', 'slack')
      .eq('amount', +amount.toFixed(2));
    if (sameDay && sameDay.length) {
      return { statusCode: 200, body: 'duplicate (same day, same amount)' };
    }
  }

  await admin.from('expenses').insert({
    corporation_id: corp.id, category_id: cat.id, date: iso,
    amount: +amount.toFixed(2), memo,
    source: 'slack', status, method: 'cash',
    slack_ts: ev.ts, slack_user: ev.user || null,
  });
  // A Supabase database webhook on expenses INSERT (status=pending) fires
  // push-notify to owner/assistant. No direct call needed here.

  return { statusCode: 200, body: familiar ? 'ok (auto-confirmed)' : 'ok (pending)' };
};
