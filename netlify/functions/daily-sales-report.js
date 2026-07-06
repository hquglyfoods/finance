// netlify/functions/daily-sales-report.js
// Posts a "DAILY SALES PER STORE" message to the Slack #financial channel every
// morning, replacing the manual report. Groups stores into Corporate vs
// Franchisee automatically from corporations.corp_type, so new franchisees are
// included without code changes.
//
// Scheduled daily (see netlify.toml). Reports the previous completed business day.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   SLACK_BOT_TOKEN
//   FINANCIAL_CHANNEL_ID   (e.g. C067CD6N3N0)

const { createClient } = require('@supabase/supabase-js');
const pad = n => String(n).padStart(2, '0');

function fmtMoney(n) {
  return '$ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

exports.handler = async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });

  // previous day (ET-ish). Business day is the day that just closed.
  const now = new Date();
  const et = new Date(now.getTime() - 4 * 3600 * 1000);
  et.setDate(et.getDate() - 1);
  const iso = `${et.getFullYear()}-${pad(et.getMonth() + 1)}-${pad(et.getDate())}`;
  const label = `${et.getMonth() + 1}/${pad(et.getDate())}/${et.getFullYear()}`;

  // corporations that have store sales (corporate + franchisee); skip HQ / UMMA
  const { data: corps } = await admin.from('corporations')
    .select('id,code,name,corp_type,display_order').order('display_order');
  const storeCorps = (corps || []).filter(c => c.corp_type === 'corporate' || c.corp_type === 'franchisee'
    || (c.corp_type == null && !['HQ', 'UMMA'].includes(c.code)));
  if (!storeCorps.length) return { statusCode: 200, body: 'no store corps' };

  const ids = storeCorps.map(c => c.id);
  // channels that count toward total
  const { data: channels } = await admin.from('revenue_channels')
    .select('id,corporation_id,counts_in_total,total_multiplier').in('corporation_id', ids);
  const chBy = {}; (channels || []).forEach(c => chBy[c.id] = c);
  // yesterday's revenue for those corps
  const { data: revs } = await admin.from('daily_revenue')
    .select('corporation_id,channel_id,amount').in('corporation_id', ids).eq('date', iso);

  const totalByCorp = {};
  storeCorps.forEach(c => totalByCorp[c.id] = 0);
  (revs || []).forEach(r => {
    const ch = chBy[r.channel_id]; if (!ch || !ch.counts_in_total) return;
    totalByCorp[r.corporation_id] += Number(r.amount) * Number(ch.total_multiplier || 1);
  });

  const corporate = storeCorps.filter(c => c.corp_type === 'corporate' || c.corp_type == null);
  const franchise = storeCorps.filter(c => c.corp_type === 'franchisee');

  // pretty store label: use name without the "Ugly XX (" wrapper if present
  const nameOf = c => {
    const m = c.name.match(/\(([^)]+)\)/);
    return m ? m[1] : c.name.replace(/^Ugly\s+\w+\s*/, '') || c.name;
  };

  let text = `*DAILY SALES PER STORE ${label}*\n\n`;
  if (corporate.length) {
    text += `:white_check_mark: Corporate stores:\n`;
    corporate.forEach(c => { text += `${nameOf(c)}: ${fmtMoney(totalByCorp[c.id])}\n`; });
    text += `\n`;
  }
  if (franchise.length) {
    text += `:white_check_mark: Franchisee stores:\n`;
    franchise.forEach(c => { text += `${nameOf(c)}: ${fmtMoney(totalByCorp[c.id])}\n`; });
  }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN },
    body: JSON.stringify({ channel: process.env.FINANCIAL_CHANNEL_ID, text, mrkdwn: true }),
  });
  const out = await res.json();
  if (!out.ok) return { statusCode: 500, body: JSON.stringify({ error: out.error, date: iso }) };
  return { statusCode: 200, body: JSON.stringify({ ok: true, date: iso, corporate: corporate.length, franchise: franchise.length }) };
};
