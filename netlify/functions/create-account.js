// netlify/functions/create-account.js
// Creates a Finance Tool account (auth user + profile + permissions).
// Only callers whose profile role is 'owner' may use this.
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY, ALLOWED_ORIGIN

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

function cors(origin) {
  const ok = ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean).includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

exports.handler = async (event) => {
  const headers = cors(event.headers.origin || event.headers.Origin || '');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing token' }) };

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // verify caller
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user)
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

    const { data: caller } = await admin.from('profiles')
      .select('role, active').eq('id', userData.user.id).maybeSingle();
    if (!caller || !caller.active || caller.role !== 'owner')
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Owner only' }) };

    const body = JSON.parse(event.body || '{}');

    // ---- account management actions (owner-only, same auth as creation) ----
    if (body.action === 'delete' || body.action === 'reset_password') {
      const targetId = body.id;
      if (!targetId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
      if (targetId === userData.user.id)
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'You cannot delete or reset your own account here' }) };

      if (body.action === 'reset_password') {
        const pw = body.password;
        if (!pw || String(pw).length < 8)
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password must be at least 8 characters' }) };
        const { error } = await admin.auth.admin.updateUserById(targetId, { password: String(pw) });
        if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      // delete: remove permissions + profile, then the auth user
      await admin.from('permissions').delete().eq('profile_id', targetId);
      await admin.from('profiles').delete().eq('id', targetId);
      const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
      if (delErr) return { statusCode: 400, headers, body: JSON.stringify({ error: delErr.message }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    const { email, password, full_name, role, permissions } = body;
    if (!email || !password || !full_name || !role)
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    if (!['owner', 'assistant', 'investor', 'viewer'].includes(role))
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid role' }) };
    if (String(password).length < 8)
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password must be 8+ characters' }) };

    // create auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr)
      return { statusCode: 400, headers, body: JSON.stringify({ error: createErr.message }) };

    const uid = created.user.id;

    // profile
    const { error: profErr } = await admin.from('profiles')
      .insert({ id: uid, email, full_name, role });
    if (profErr) {
      await admin.auth.admin.deleteUser(uid);
      return { statusCode: 400, headers, body: JSON.stringify({ error: profErr.message }) };
    }

    // permissions (skipped for owner: owners have global access)
    if (role !== 'owner' && Array.isArray(permissions) && permissions.length) {
      const rows = permissions
        .filter(p => p.corporation_id)
        .map(p => ({
          profile_id: uid,
          corporation_id: p.corporation_id,
          can_view: !!p.can_view,
          can_edit: !!p.can_edit,
        }));
      if (rows.length) {
        const { error: permErr } = await admin.from('permissions').insert(rows);
        if (permErr)
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'User created, permissions failed: ' + permErr.message }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: uid }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
