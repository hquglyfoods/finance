// netlify/functions/recurring-cron.js
// Runs daily (schedule set in netlify.toml). Materializes all recurring
// expenses due today (and catches up the last 7 days in case a run was missed).
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();

exports.handler = async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data: rules, error: rerr } = await admin
    .from('recurring_expenses').select('*').eq('active', true);
  if (rerr) return { statusCode: 500, body: JSON.stringify({ error: rerr.message }) };

  // catch-up window: today and the previous 6 days
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const winStart = dstr(days[0]);
  const winEnd = dstr(days[days.length - 1]);

  const { data: existing, error: eerr } = await admin
    .from('expenses').select('recurring_id, date')
    .not('recurring_id', 'is', null)
    .gte('date', winStart).lte('date', winEnd);
  if (eerr) return { statusCode: 500, body: JSON.stringify({ error: eerr.message }) };

  const have = new Set((existing || []).map(e => e.recurring_id + '|' + e.date));
  const inserts = [];

  for (const r of rules || []) {
    for (const d of days) {
      const date = dstr(d);
      if (r.start_date && date < r.start_date) continue;
      if (r.end_date && date > r.end_date) continue;
      const ld = lastDay(d.getFullYear(), d.getMonth() + 1);
      const targetDom = r.day_of_month === 99 ? ld : Math.min(r.day_of_month, ld);
      const due = r.frequency === 'weekly'
        ? d.getDay() === r.day_of_week
        : d.getDate() === targetDom;
      if (due && !have.has(r.id + '|' + date)) {
        const amt = (r.next_amount != null && r.next_amount_from && date >= r.next_amount_from)
          ? Number(r.next_amount) : Number(r.amount);
        inserts.push({
          corporation_id: r.corporation_id,
          category_id: r.category_id,
          date,
          amount: amt,
          payee: r.payee || null,
          memo: r.name,
          source: 'recurring',
          recurring_id: r.id,
        });
      }
    }
  }

  if (inserts.length) {
    const { error: ierr } = await admin.from('expenses').insert(inserts);
    if (ierr) return { statusCode: 500, body: JSON.stringify({ error: ierr.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, created: inserts.length }) };
};
