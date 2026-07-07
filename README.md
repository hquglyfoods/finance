# Ugly Finance Tool - Entry date picker opens + recurring lease safety

Two things:

1) ENTRY DATE PICKER. Tapping the date chip in the Entry tab (Revenue and Add Expense)
   didn't reliably open the calendar popup. It now calls the browser's date picker
   directly on click, so the calendar opens every time.

2) MALL COMMISSION / LEASE. Your commission formula is already correct:
   max(0, total_sales * 0.15 - cat_lease). It looked wrong this month only because the
   month's Lease hadn't been entered yet, so cat_lease was 0 and the full 15% showed.
   Since Lease is a monthly recurring booked on the 1st, this normally self-corrects.
   To make sure a monthly recurring due on the 1st is never missed (e.g. if the cron had
   a gap), the recurring job now always includes the 1st of the current month in its
   catch-up window, not just the last 7 days. Once this month's Lease is booked, the
   commission recalculates correctly on its own.

No SQL this round. (No change to the commission rule - it was already right.)
