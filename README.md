# Ugly Finance Tool - UMMA orders book immediately (incoming_store_orders)

FOUND IT: UMMA store orders land in the Inventory app's incoming_store_orders table
(status 'new') and only reach the orders table when fulfilled in the Inventory app.
Finance read only orders + import_queue, so a brand-new UMMA order (like today's
$198) was invisible until someone fulfilled it.

FIX in netlify/functions/inventory-sync.js
- The sync now ALSO reads incoming_store_orders (sources ummasrecipe-store/wix) and
  counts rows that are not yet fulfilled.
- Double dedupe guard (no link column exists between the tables): a row is skipped if
  EITHER its order_no already appears as an orders.external_id, OR its status is
  fulfilled/cancelled/rejected/refunded (list extendable via env
  INV_INCOMING_EXCLUDE_STATUSES). Verified with the real production rows: before
  approval total = $2,156 (the new $198 included); after approval still $2,156 -
  double counting impossible under either table structure.
- Revenue date = UTC date of created_at, matching how the Inventory app stamps
  order_date on approval, so the date never shifts when an order is later fulfilled.
- Diagnostics: response JSON adds incomingNew and incomingNewTotal (plus
  incomingReadError if that table read fails; confirmed orders still sync).

VERIFY NOW
1) Deploy, then open:
   https://uglyfinance.netlify.app/.netlify/functions/inventory-sync-now?key=YOUR_WEBHOOK_SECRET
2) Expect incomingNew: 1, incomingNewTotal: 198, and ummaRevenueByChannel.ugly
   increased by 198.
3) The $198 books to July 7, so it appears on the UMMA home card as today's sales.

No SQL this round.
