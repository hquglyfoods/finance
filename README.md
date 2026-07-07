# Ugly Finance Tool - home card alignment + (already included) HQ/UMMA sync fix

1) Home cards now keep the same height whether or not a store has last-week data.
   The "vs last [day]" line always renders; when there is no data for the same weekday
   last week it shows a faint "No sales last [day]" placeholder, and the 7-day
   sparkline area is always reserved. So HQ/UMMA cards no longer float up.

2) Reminder: the inventory-sync fix in this build covers BOTH UMMA and HQ - they sync
   through the same function, so the old "window starts yesterday" bug also delayed
   today's HQ (QuickBooks) revenue by a day. With this build, today's orders/invoices
   are picked up on the next hourly sync.

No SQL this round.
