// netlify/functions/toast-backfill-background.js
//
// One-call historical backfill for a store, without hitting the 26s function limit.
// Netlify gives any function whose name ends in "-background" up to 15 minutes, so we can
// walk many weeks here. Internally we reuse the normal toast-sync handler, calling it once
// per chunk so each individual Toast pull stays small.
//
// Usage:
//   /.netlify/functions/toast-backfill-background?start=2025-08-01&end=2026-07-21&only=PEARLAND
//
// Background function: the HTTP request returns 202 immediately and the work continues on
// the server. Watch the function logs for [backfill] progress, then check the app.
//
// Params:
//   start, end   inclusive YYYY-MM-DD range
//   only         store code(s), comma-separated (e.g. PEARLAND). Recommended so a backfill
//                doesn't touch board-finalized corporate months.
//   tips_only    defaults to '0' here (we want revenue). Pass '1' for tips only.
//   chunk_days   days per chunk (default 7).

const sync = require('./toast-sync.js');

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

exports.handler = async (event) => {
  const qp = (event && event.queryStringParameters) || {};
  const start = qp.start, end = qp.end;
  if (!start || !end) {
    return { statusCode: 400, body: JSON.stringify({ error: 'start and end (YYYY-MM-DD) required' }) };
  }
  const only = qp.only || '';
  const tipsOnly = qp.tips_only || '0';
  const chunkDays = Math.max(1, Math.min(31, parseInt(qp.chunk_days || '7', 10)));

  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  const summary = [];
  let cur = new Date(s);

  while (cur <= e) {
    const chunkStart = new Date(cur);
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
    if (chunkEnd > e) chunkEnd.setTime(e.getTime());

    const evt = { queryStringParameters: {
      start: iso(chunkStart), end: iso(chunkEnd), tips_only: tipsOnly, only,
    } };
    try {
      const res = await sync.handler(evt);
      let body = {};
      try { body = JSON.parse(res.body || '{}'); } catch (_) {}
      const log = body.log || [];
      const nonZero = log.filter(l => /(card|cash) [1-9]/.test(l)).length;
      summary.push(`${iso(chunkStart)}..${iso(chunkEnd)}: ${log.length} days, ~${nonZero} with sales`);
      console.log(`[backfill] ${iso(chunkStart)}..${iso(chunkEnd)} done (${log.length} days)`);
    } catch (err) {
      summary.push(`${iso(chunkStart)}..${iso(chunkEnd)}: ERROR ${err.message}`);
      console.log(`[backfill] ${iso(chunkStart)}..${iso(chunkEnd)} ERROR ${err.message}`);
    }

    cur.setUTCDate(cur.getUTCDate() + chunkDays);
  }

  console.log('[backfill] complete:\n' + summary.join('\n'));
  return { statusCode: 202, body: JSON.stringify({ ok: true, chunks: summary.length, summary }) };
};
