# Ugly Finance Tool - first-run "turn on notifications" prompt

Context: push notifications were working server-side (the webhook logged sent: 1), but
after reinstalling the app the new install had no notification permission, so nothing
arrived on the device. Easy to miss on iOS, where you have to opt in.

Added: a one-time, friendly prompt that appears the first time the INSTALLED app is
opened by an owner/assistant when notifications haven't been enabled yet. "Turn on
notifications" requests permission and registers the push subscription; "Maybe later"
dismisses it. It only shows:
- in the installed PWA (not a browser tab),
- for owner/assistant (investors don't get approval pings),
- while the browser permission is still "default" (never asked),
- once (it won't nag again after enabling or dismissing).

Verified: prompt shows on first standalone open, dismiss hides it and it doesn't return
after reload.

The Slack photo diagnostic logs are still in place from the previous build; they can be
removed in a later cleanup.
