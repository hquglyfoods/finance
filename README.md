# Ugly Finance Tool - notification list auto-cleanup

The bell notification list no longer grows forever.

Rule (runs inside the existing daily recurring-cron, no new schedule):
- A notification is deleted only if it is older than 30 days AND at least one person
  has read it.
- Anything still UNREAD is kept indefinitely, no matter how old, so a missed alert
  never disappears.
- Read records are deleted first, then the notifications, so no orphan rows are left.
- The cron response now includes notifCleaned (how many were removed).

UI: the bell still shows the most recent notifications (cap raised 30 -> 50 for
headroom) with unread ones highlighted and "Mark all read". Because seen items age
out after a month, the list stays short on its own.

Verified: cleanup keeps unread and recent items, removes only read items older than
30 days.

No SQL this round (uses existing notifications / notification_reads tables).
