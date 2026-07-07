# Ugly Finance Tool - web push: both root causes fixed + diagnostics

Two independent causes could stop web push. Both are now handled.

## Diagnostics (build first, then use to verify)
- netlify/functions/push-test.js (owner-only): bypasses the webhook and fires a REAL
  push to your own subscriptions, returning JSON per step (env keys present, key loads
  as EC, subscription count, per-send status/error).
- "Send test push" button: Install App & Notifications -> Diagnostics (owner only).
- push-notify.js now logs the webhook path:
    WEBHOOK AUTH FAIL {hasSecret,keyLen}  - key did not match
    WEBHOOK IN {table,type,keys}          - webhook reached the function
    WEBHOOK IGNORED {table,type,reason}   - conditions not met (reason is explicit)
    WEBHOOK SENT {targets,sent,removed,errors}
  When ignored, the HTTP response body is JSON {ok:false, ignored:true, reason:"..."}
  so you can see why nothing was sent without digging through logs.

## Cause 1 - VAPID private key PEM broke (newlines stripped on paste)
Symptom: send fails with error:1E08010C:DECODER routines::unsupported.
- lib/push.js loads the key in any of 3 forms: (1) base64 one-line PEM, (2) \n-escaped,
  (3) real PEM. All three verified to load via crypto.createPrivateKey as EC.
- convert-vapid-key.js turns THIS app's PEM into a single base64 line to paste into
  Netlify (no newlines to lose). The key never leaves your machine. Use THIS app's key.

## Cause 2 - webhook ?key= had angle brackets / spaces
Symptom: webhook delivery logs 401 unauthorized.
Cause: the setup docs show ?key=<SECRET>; if the < > placeholder brackets are left in,
the sent key becomes "<value>" and never matches WEBHOOK_SECRET.
- push-notify.js now strips leading/trailing < > and whitespace before comparing:
    const rawKey = ((qs||{}).key||'').trim().replace(/^[<]+|[>]+$/g,'');
    const secret = (process.env.WEBHOOK_SECRET||'').trim();
    if (!secret || rawKey !== secret) return 401;
  So even a URL still containing <SECRET> authenticates. (Best practice: also remove
  the brackets from the webhook URL in Supabase.)

## DEPLOY ORDER (env changes need a redeploy)
1) Deploy this build (drag-drop the zip, or push the repo).
2) Cause 1: locally run  node convert-vapid-key.js vapid_private.pem  on THIS app's
   current PEM, copy the one base64 line, replace VAPID_PRIVATE_KEY in Netlify, save.
3) Trigger deploy in Netlify (env vars only apply on a new deploy).
4) Cause 1 check: app -> Install App & Notifications -> Diagnostics -> Send test push.
   Expect ok:true, "Key loads (EC): true (ec)", Sent >= 1, and a real notification.
5) Cause 2 check: trigger each webhook event once in Supabase, then run:
     select h.hook_name, r.status_code, r.content, r.created
     from net._http_response r
     join supabase_functions.hooks h on h.request_id = r.id
     order by r.id desc limit 10;
   401 -> 200 means the key fix worked. For status-transition events (e.g. an expense
   turning pending, or a monthly_close turning published), briefly revert then restore
   the record to safely re-fire the webhook. The function response body also shows
   ignored/reason if a condition was not met.
