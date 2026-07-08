# Ugly Finance Tool - first-run notification prompt

When the app is opened as an installed PWA (Android or iPhone) and the user hasn't yet
decided on notifications, a one-time popup now asks if they want to turn them on.

- Shows only inside the installed app (not the browser), only when the OS permission is
  still undecided, and only once. "Maybe later" or tapping outside dismisses it for good.
- "Turn on notifications" requests the OS permission and registers the push subscription
  right there, so they're set up in one tap.
- Skipped for investor accounts.

It remembers the choice with a local flag (ft_notif_prompted), so it never nags again on
that device even after reloads. Anyone can still turn notifications on or off later from
the Install App & Notifications screen.

Verified: the popup appears once in a standalone install with undecided permission;
tapping "Turn on" subscribes and closes it; it does not reappear on reload.
