-- ============================================================================
-- Why does the Home card show "Last Sun same time: $0" with no % today?
--
-- The same-time comparison reads revenue_snapshots for the SAME WEEKDAY LAST
-- WEEK (for Sunday 2026-07-19 that is Sunday 2026-07-12). If there are no
-- snapshot rows for that date, or their running amount is 0 at this time of day,
-- the card has nothing to compare against and shows $0 with no percentage.
--
-- This is not affected by the recent Home speed change; snapshots are recorded
-- by the sync functions, independent of the Home queries. Read-only.
-- ============================================================================

-- 1) Do we have ANY snapshots for last Sunday, per store?
SELECT co.code AS store, count(*) AS snapshot_rows,
       min(rs.hour*60+COALESCE(rs.minute,0)) AS first_min,
       max(rs.hour*60+COALESCE(rs.minute,0)) AS last_min,
       max(rs.amount) AS max_running_amount
FROM public.revenue_snapshots rs
JOIN public.corporations co ON co.id = rs.corporation_id
WHERE rs.date = '2026-07-12'
GROUP BY co.code
ORDER BY co.code;

-- 2) For comparison, last SATURDAY (2026-07-11) - the day that worked yesterday.
--    If Saturday has rows and Sunday does not, that explains the difference.
SELECT co.code AS store, count(*) AS snapshot_rows, max(rs.amount) AS max_running_amount
FROM public.revenue_snapshots rs
JOIN public.corporations co ON co.id = rs.corporation_id
WHERE rs.date = '2026-07-11'
GROUP BY co.code
ORDER BY co.code;

-- 3) How far back does snapshot history go per store? (When did recording start?)
SELECT co.code AS store, min(rs.date) AS earliest, max(rs.date) AS latest, count(DISTINCT rs.date) AS days
FROM public.revenue_snapshots rs
JOIN public.corporations co ON co.id = rs.corporation_id
GROUP BY co.code
ORDER BY co.code;
