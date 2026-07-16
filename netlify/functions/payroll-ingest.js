// netlify/functions/payroll-ingest.js
//
// Payroll intake for the HR app (parallel to slack-payroll.js, which still runs).
//
// The HR app computes each store's hours, the owner enters them into ADP, and the HR
// app then POSTs the resulting payroll summary here. This books the same rows the Slack
// path books, so downstream nothing changes: Payroll and Payroll Tax land in `expenses`
// as confirmed rows dated the pay-period end (the Sunday that closes the work week).
//
// Both paths write with a shared dedupe key in the `slack_ts` column, which has a UNIQUE
// index. So if the same week is sent from BOTH Slack and the HR app, the second one is
// skipped rather than double-booked. The key here is:  hr_<periodEnd>_<store>_<p|t>
// (Slack uses pr_<ts>_<store>_<p|t>); a store+week is therefore one payroll row and one
// tax row no matter how many times it is submitted.
//
// SECURITY: the HR app must send a shared secret in the X-Payroll-Token header, matching
// the PAYROLL_INGEST_TOKEN env var. Without it the request is rejected.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   PAYROLL_INGEST_TOKEN     shared secret the HR app sends in X-Payroll-Token
//   PAYROLL_STORE_CODES      (optional) allowed store codes, default "AD,BW,FH"
//
// Request (POST, application/json):
//   {
//     "period_end": "2026-07-12",              // Sunday that closes the work week (required)
//     "entries": [
//       { "store": "AD", "payroll": 3910.22, "payroll_tax": 512.40 },
//       { "store": "BW", "payroll": 2150.00, "payroll_tax": 290.11 }
//     ],
//     "source_note": "HR app auto-calc",       // optional, appended to the memo
//     "correction": false                       // optional; see below
//   }
//
// correction flag:
//   Normally a store+week already booked is left untouched, so a resend or a double-tap is
//   a safe no-op. Set "correction": true ONLY when deliberately fixing an already-sent
//   week: it overwrites that store+week's amount with the new figure. A correction to a
//   month that has been closed/published means that month's report must be re-published to
//   reflect the change.
//
// Response:
//   200 { ok:true, period_end, saved, stores:[...], skipped:<n> }
//   4xx { ok:false, error:"..." }               on bad input / auth

const { createClient } = require('@supabase/supabase-js');

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

// A valid YYYY-MM-DD within a sane recent window (same rule as the Slack path).
function validPeriodEnd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  if (isNaN(t)) return null;
  const now = Date.now();
  if (t < now - 60 * 864e5 || t > now + 14 * 864e5) return null;
  return s;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  // shared-secret auth
  const expected = process.env.PAYROLL_INGEST_TOKEN;
  const got = event.headers['x-payroll-token'] || event.headers['X-Payroll-Token'];
  if (!expected || !got || got !== expected) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'invalid JSON' }); }

  const periodEnd = validPeriodEnd(payload.period_end);
  if (!periodEnd) return json(400, { ok: false, error: 'period_end must be a recent YYYY-MM-DD (the Sunday that closes the work week)' });

  const entries = Array.isArray(payload.entries) ? payload.entries : null;
  if (!entries || !entries.length) return json(400, { ok: false, error: 'entries[] is required' });

  // Deliberate correction of an already-sent week overwrites; otherwise a repeat is ignored.
  const isCorrection = payload.correction === true;

  const storeCodes = (process.env.PAYROLL_STORE_CODES || 'AD,BW,FH')
    .split(',').map(s => s.trim()).filter(Boolean);
  const noteSuffix = typeof payload.source_note === 'string' && payload.source_note.trim()
    ? ` (${payload.source_note.trim().slice(0, 80)})` : '';

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // resolve corp + category ids for the allowed stores
  const { data: corps, error: corpErr } = await admin.from('corporations').select('id,code').in('code', storeCodes);
  if (corpErr) return json(500, { ok: false, error: 'corp lookup: ' + corpErr.message });
  const corpByCode = {}; (corps || []).forEach(c => corpByCode[c.code] = c.id);
  const corpIds = (corps || []).map(c => c.id);

  const { data: cats, error: catErr } = await admin.from('expense_categories')
    .select('id,corporation_id,code').in('corporation_id', corpIds).in('code', ['payroll', 'payroll_tax']);
  if (catErr) return json(500, { ok: false, error: 'category lookup: ' + catErr.message });
  const catBy = {}; (cats || []).forEach(c => { catBy[c.corporation_id + '|' + c.code] = c.id; });

  const rows = [];
  const summary = [];
  const unknown = [];
  for (const e of entries) {
    const store = String(e.store || '').trim().toUpperCase();
    const corpId = corpByCode[store];
    if (!corpId) { unknown.push(store || '(blank)'); continue; }
    const payroll = round2(e.payroll);
    const tax = round2(e.payroll_tax);

    if (payroll > 0 && catBy[corpId + '|payroll']) {
      rows.push({
        corporation_id: corpId, category_id: catBy[corpId + '|payroll'], date: periodEnd,
        amount: payroll, memo: `Payroll (ADP, HR app) wk ending ${periodEnd}${noteSuffix}`,
        source: 'payroll_bot', status: 'confirmed', slack_ts: `hr_${periodEnd}_${store}_p`,
      });
    }
    if (tax > 0 && catBy[corpId + '|payroll_tax']) {
      rows.push({
        corporation_id: corpId, category_id: catBy[corpId + '|payroll_tax'], date: periodEnd,
        amount: tax, memo: `Payroll tax (ADP, HR app) wk ending ${periodEnd}${noteSuffix}`,
        source: 'payroll_bot', status: 'confirmed', slack_ts: `hr_${periodEnd}_${store}_t`,
      });
    }
    summary.push({ store, payroll, payroll_tax: tax, period_end: periodEnd });
  }

  if (!rows.length) {
    return json(422, {
      ok: false,
      error: 'nothing to book',
      detail: unknown.length ? `unrecognized stores: ${unknown.join(', ')}` : 'all amounts were zero or categories missing',
    });
  }

  // Write row by row so one already-present key does not roll back the batch.
  //
  //   normal send   : ignoreDuplicates -> a store+week already booked is a no-op (safe
  //                   resend / double-tap), enforced by the unique index on slack_ts.
  //   correction=true: overwrite that store+week's amount and memo with the new figure.
  //
  // Either way the unique slack_ts keeps the Slack path and this path from double-booking.
  let saved = 0, skipped = 0, corrected = 0;
  for (const r of rows) {
    if (isCorrection) {
      // does the row already exist for this store+week?
      const { data: ex, error: exErr } = await admin.from('expenses')
        .select('id,amount').eq('slack_ts', r.slack_ts).maybeSingle();
      if (exErr) return json(500, { ok: false, error: 'lookup: ' + exErr.message });
      if (ex) {
        if (Number(ex.amount) === Number(r.amount)) { skipped += 1; continue; }  // same value
        const { error } = await admin.from('expenses')
          .update({ amount: r.amount, memo: r.memo + ' [corrected]', status: 'confirmed' })
          .eq('id', ex.id);
        if (error) return json(500, { ok: false, error: 'update: ' + error.message });
        corrected += 1;
        continue;
      }
      // no existing row: fall through to a plain insert below
    }
    const { data, error } = await admin.from('expenses')
      .upsert(r, { onConflict: 'slack_ts', ignoreDuplicates: true })
      .select('id');
    if (error) return json(500, { ok: false, error: 'insert: ' + error.message });
    if (data && data.length) saved += 1; else skipped += 1;
  }

  return json(200, {
    ok: true,
    period_end: periodEnd,
    saved,
    corrected,
    skipped,
    stores: summary,
    note: (saved === 0 && corrected === 0) ? 'all rows already recorded' : undefined,
  });
};
