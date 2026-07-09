// netlify/functions/push-notify.js
// Triggered by Supabase Database Webhooks on INSERT/UPDATE. Zero npm deps:
// talks to Supabase via REST with the service key.
//
// Routing:
//   expenses INSERT with status='pending'  -> notify owner + assistant (new approval)
//   monthly_close UPDATE to status='published' -> notify investors of that corp
//
// Badge: for owner/assistant subs -> current pending count.
//        for investor subs        -> published reports they may not have seen (count of published for their corps).
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//           WEBHOOK_SECRET, VAPID_SUBJECT (optional, default mailto:hq@uglydonutsncorndogs.com)

const { sendPush } = require('./lib/push.js');

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path, extraHeaders) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    headers: Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, extraHeaders || {}),
  });
  return res;
}
async function sbJson(path) { const r = await sbGet(path); return r.ok ? r.json() : []; }

async function countExact(path) {
  const res = await sbGet(path, { Prefer: 'count=exact', Range: '0-0' });
  const cr = res.headers.get('content-range') || '0-0/0';
  const total = parseInt(cr.split('/')[1] || '0', 10);
  return isNaN(total) ? 0 : total;
}

async function sbDelete(path) {
  await fetch(`${SB}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
  });
}

exports.handler = async (event) => {
  // Auth: strip stray angle brackets / whitespace from the ?key= value so a webhook
  // URL pasted as ?key=<SECRET> (placeholder brackets left in) still authenticates.
  const rawKey = ((event.queryStringParameters || {}).key || '').trim().replace(/^[<]+|[>]+$/g, '');
  const secret = (process.env.WEBHOOK_SECRET || '').trim();
  if (!secret || rawKey !== secret) {
    console.log('WEBHOOK AUTH FAIL', { hasSecret: !!secret, keyLen: rawKey.length });
    return { statusCode: 401, body: 'unauthorized' };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  const { table, type, record, old_record } = payload;
  console.log('WEBHOOK IN', { table, type, keys: record ? Object.keys(record) : [] });

  // Decide target roles + message
  let targetRoles = null;         // ['owner','assistant'] or ['investor']
  let corpId = null;              // for investor targeting
  let title = 'Ugly Finance', body = '';

  if (table === 'expenses' && type === 'INSERT' && record && record.status === 'pending') {
    targetRoles = ['owner', 'assistant'];
    title = 'New expense to approve';
    body = 'A Slack expense is waiting for approval.';
  } else if (table === 'monthly_close' && (type === 'UPDATE' || type === 'INSERT')
             && record && record.status === 'published'
             && (!old_record || old_record.status !== 'published')) {
    targetRoles = ['investor'];
    corpId = record.corporation_id;
    title = 'New monthly report';
    body = 'A new monthly report has been published.';
  } else {
    // Explain why nothing was sent so the reason is visible in logs and the response.
    const reason =
      (table !== 'expenses' && table !== 'monthly_close') ? `table "${table}" is not handled` :
      (table === 'expenses' && type !== 'INSERT') ? `expenses ${type} ignored (only INSERT)` :
      (table === 'expenses' && (!record || record.status !== 'pending')) ? `expense status is "${record ? record.status : 'none'}" (need pending)` :
      (table === 'monthly_close' && (!record || record.status !== 'published')) ? `monthly_close status is "${record ? record.status : 'none'}" (need published)` :
      (table === 'monthly_close' && old_record && old_record.status === 'published') ? 'monthly_close was already published (no transition)' :
      'conditions not met';
    console.log('WEBHOOK IGNORED', { table, type, reason });
    return { statusCode: 200, body: JSON.stringify({ ok: false, ignored: true, reason }) };
  }

  // Which app tab this alert points to (used by the bell and by push-click navigation).
  const linkTab = table === 'expenses' ? 'approvals' : 'investor';

  // Log to the in-app notifications feed (the bell), so alerts show in-app too.
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        title, body,
        kind: table === 'expenses' ? 'pending' : 'published',
        target_role: table === 'expenses' ? 'staff' : 'investor',
        corporation_id: corpId || null,
        link_tab: linkTab,
      }),
    });
  } catch (e) { /* non-fatal: push still sends */ }

  const opts = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY || '',   // lib/push.js normalizes (base64 / \n / raw PEM)
    subject: process.env.VAPID_SUBJECT || 'mailto:hq@uglydonutsncorndogs.com',
  };

  // pending count for owner/assistant badge
  const pendingCount = await countExact(`expenses?status=eq.pending&select=id`);

  // gather target subscriptions
  let subs = [];
  if (targetRoles.includes('investor')) {
    // investors who can view this corp
    const perms = await sbJson(`permissions?corporation_id=eq.${corpId}&can_view=eq.true&select=profile_id`);
    const ids = perms.map(p => p.profile_id);
    if (ids.length) {
      const list = ids.join(',');
      subs = await sbJson(`push_subscriptions?role=eq.investor&profile_id=in.(${list})&select=*`);
    }
  } else {
    subs = await sbJson(`push_subscriptions?role=in.(owner,assistant)&select=*`);
  }

  let sent = 0, removed = 0, errors = [];
  for (const row of subs) {
    const sub = row.subscription;
    // badge value depends on recipient role
    let badge = 0;
    if (row.role === 'investor') {
      badge = await countExact(`monthly_close?status=eq.published&select=id`);
    } else {
      badge = pendingCount;
    }
    try {
      const r = await sendPush(sub, { title, body, badge, tag: table, tab: linkTab }, opts);
      if (r.gone) { await sbDelete(`push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`); removed++; }
      else if (r.ok) sent++;
      else errors.push('status ' + r.status);
    } catch (e) { errors.push(String(e.message || e)); }
  }
  console.log('WEBHOOK SENT', { targets: subs.length, sent, removed, errors: errors.slice(0, 3) });

  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, removed, targets: subs.length, errors: errors.slice(0, 3) }) };
};
