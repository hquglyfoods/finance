# Ugly Finance Tool - fixes from screenshots

1. Cash pickup save error (counted_amount not-null): run 23_cash_pickup_nullable.sql.
   Envelopes can now be saved without a counted amount (sealed pickups).
2. Insights cards fit the screen everywhere. The 3-card views (Daily, Month, Year,
   3-Year, All-Time) use compact currency ($1.95M, $226.3K) so large numbers no
   longer run off the right edge. Card size matches the Daily look.
3. No horizontal overflow anywhere (verified 0px).
4. Home store cards: 2 per row on mobile (was 1).
5. Settings: removed the "Generate This Month" button (recurring auto-generates
   daily via cron now).

SQL to run: 23_cash_pickup_nullable.sql
