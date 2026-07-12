// netlify/functions/lib/snapshots.js
// Intraday cumulative sales snapshots, one row per (corporation, date, hour).
//
// Why: the Home cards compare today's running sales against last week. Comparing a
// half-finished day against last week's FULL day always looks like a crash in the
// morning, so the app needs "how much had this store sold by this hour last week".
// daily_revenue only stores day totals, so the hourly syncs capture a snapshot of
// today's running total each run, and (for Toast stores) backfill last week's hours
// from order timestamps so the comparison works immediately after deploy.
//
// All writes go through the service key; the table has read-only RLS for the app
// (sql/revenue_snapshots.sql). Every function here is fail-soft: a snapshot problem
// must never break the revenue sync itself, so callers wrap in try/catch and we
// swallow "table missing" errors with a log line.

const localHourMin = (tz) => {
  const parts = new Intl.DateTimeFormat('en-US',
    { timeZone: tz || 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date());
  const get = t => Number((parts.find(p => p.type === t) || {}).value || 0);
  return { hour: get('hour'), minute: get('minute') };
};
const localHour = (tz) => localHourMin(tz).hour;

// Capture "total counts-in-total sales so far today" for one corp, computed exactly
// the way the app totals a day (counts_in_total + total_multiplier), so the snapshot
// always matches what the Home card showed at that moment. Minute-precise and
// change-driven: a row is written only when the running total actually moved, so a
// per-minute sync writes a handful of rows per day, not 1,440.
async function captureSnapshot(admin, corpId, dateIso, tz) {
  const { hour, minute } = localHourMin(tz);
  const [{ data: rows }, { data: chs }, { data: last }] = await Promise.all([
    admin.from('daily_revenue').select('channel_id,amount').eq('corporation_id', corpId).eq('date', dateIso),
    admin.from('revenue_channels').select('id,counts_in_total,total_multiplier').eq('corporation_id', corpId),
    admin.from('revenue_snapshots').select('amount').eq('corporation_id', corpId).eq('date', dateIso)
      .order('hour', { ascending: false }).order('minute', { ascending: false }).limit(1),
  ]);
  const chBy = {}; (chs || []).forEach(c => { chBy[c.id] = c; });
  let total = 0;
  (rows || []).forEach(r => {
    const c = chBy[r.channel_id];
    if (c && c.counts_in_total) total += Number(r.amount) * Number(c.total_multiplier || 1);
  });
  total = +total.toFixed(2);
  if ((last || []).length && Number(last[0].amount) === total) return;   // unchanged: no write
  const { error } = await admin.from('revenue_snapshots').upsert({
    corporation_id: corpId, date: dateIso, hour, minute, amount: total,
    captured_at: new Date().toISOString(),
  }, { onConflict: 'corporation_id,date,hour,minute' });
  if (error) throw new Error('snapshot upsert: ' + error.message);
}

// Do hourly snapshots already exist for this corp+date?
async function hasSnapshots(admin, corpId, dateIso) {
  const { data, error } = await admin.from('revenue_snapshots').select('hour')
    .eq('corporation_id', corpId).eq('date', dateIso).limit(1);
  if (error) throw new Error('snapshot check: ' + error.message);
  return (data || []).length > 0;
}

// Rebuild a past day's hourly cumulative totals from Toast orders (payment
// timestamps) and insert 24 rows (hour 0-23, cumulative, tip-excluded,
// tax-inclusive: the same money definition the sync uses for daily totals).
// Used to backfill "last week same day" right after the feature ships.
async function backfillHourlyFromOrders(admin, corpId, dateIso, orders, tz) {
  const hourly = new Array(24).fill(0);
  for (const o of orders || []) {
    if (o.voided) continue;
    for (const chk of o.checks || []) {
      if (chk.voided || chk.deleted) continue;
      for (const p of chk.payments || []) {
        if (p.paymentStatus === 'VOIDED') continue;
        const ts = p.paidDate || chk.closedDate || o.closedDate || o.openedDate;
        if (!ts) continue;
        const h = Number(new Intl.DateTimeFormat('en-US',
          { timeZone: tz || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts)));
        if (!(h >= 0 && h <= 23)) continue;
        hourly[h] += Number(p.amount || 0) - Number(p.tipAmount || 0);
      }
    }
  }
  let run = 0;
  const rows = [];
  for (let h = 0; h < 24; h++) {
    run += hourly[h];
    // minute 59: a backfilled row means "total through the END of hour h"
    rows.push({ corporation_id: corpId, date: dateIso, hour: h, minute: 59, amount: +run.toFixed(2) });
  }
  const { error } = await admin.from('revenue_snapshots').upsert(rows, { onConflict: 'corporation_id,date,hour,minute' });
  if (error) throw new Error('snapshot backfill: ' + error.message);
}

module.exports = { captureSnapshot, hasSnapshots, backfillHourlyFromOrders, localHour };
