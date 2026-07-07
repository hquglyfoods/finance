# Ugly Finance Tool - incoming UMMA orders use store-local date

The $198 order synced fine but booked to Jul 7 (the UTC date of created_at
2026-07-07 01:41 UTC), when it was actually placed Jul 6, 9:41pm New York time.

FIX in netlify/functions/inventory-sync.js
- Not-yet-approved incoming_store_orders take their date from created_at in the store
  timezone (America/New_York; override with STORE_TIMEZONE). An evening NY order now
  books to that day, not the next. Same rule as slack-expense.
- Approved orders keep the Inventory app's order_date; only incoming (new) rows are
  computed locally, so the two paths never disagree.
- Self-healing: the write loop upserts every date in the window, so on the next sync
  the stale Jul 7 $198 is overwritten to $0 and $198 appears on Jul 6 automatically.
  No manual cleanup needed.
- Verified: $198 (created 07-07 01:41 UTC) books to 2026-07-06; daytime orders
  unaffected; stale-date cleanup confirmed.

VERIFY
1) Deploy, then run:
   https://uglyfinance.netlify.app/.netlify/functions/inventory-sync-now?key=YOUR_WEBHOOK_SECRET
2) Insights -> Daily -> UMMA: the $198 moves from Jul 7 to Jul 6. Since Jul 6 is
   "today" in New York, it now also shows on the UMMA home card.

No SQL this round.
