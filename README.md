# Ugly Finance Tool - revenue books BEFORE Inventory approval

ROOT CAUSE of UMMA showing $0: orders land in the Inventory app's import_queue
(the Import tab) first, and only move to the orders table when someone approves
them there. Finance was reading only the orders table, so unapproved orders were
invisible.

FIX in netlify/functions/inventory-sync.js
- The sync now reads BOTH tables: orders (approved) + import_queue rows whose
  order_id IS NULL (still waiting in the Import tab).
- No double counting, guaranteed by design: approving a queue row sets its
  order_id and creates the orders row, so at any moment a purchase is counted
  from exactly one table. Verified by simulation (before approval: $500; after
  approval: still $500; rejected: $0).
- Queue rows with status rejected/error/dismissed/duplicate/skipped are excluded
  (extend the list via env INV_QUEUE_EXCLUDE_STATUSES if needed).
- Diagnostic JSON now also reports queuedUnapproved (count) and
  queuedUnapprovedTotal, plus queueReadError if the queue read fails (confirmed
  orders still sync in that case).

This applies to UMMA, HQ (QuickBooks invoices), and store HQ-Supplies expenses
alike: they all book as soon as the order hits the Inventory app, approval or not.

HOW TO VERIFY RIGHT NOW (no waiting for the hourly run)
1) Deploy this build.
2) Open in a browser:
   https://uglyfinance.netlify.app/.netlify/functions/inventory-sync-now?key=YOUR_WEBHOOK_SECRET
3) The JSON should show queuedUnapproved >= 1 and ummaRevenueByChannel with
   today's amount. Then check the UMMA card in the app.

No SQL this round.
