-- ============================================================================
-- SNAPSHOT DIAGNOSTIC v2.
-- v1 sorted times as TEXT ("9:00" > "10:00"), so first/last were misleading.
-- This version sorts numerically and lists every capture, so we can see exactly
-- what exists and what is missing.
-- ============================================================================

-- A) Per corp per date: real first/last capture time, numerically ordered.
SELECT co.code AS corp, s.date, count(*) AS rows,
       to_char((min(s.hour*60 + s.minute) / 60), 'FM00') || ':' ||
       to_char((min(s.hour*60 + s.minute) % 60), 'FM00') AS first_capture,
       to_char((max(s.hour*60 + s.minute) / 60), 'FM00') || ':' ||
       to_char((max(s.hour*60 + s.minute) % 60), 'FM00') AS last_capture,
       ROUND(max(s.amount), 2) AS latest_total
FROM public.revenue_snapshots s
JOIN public.corporations co ON co.id = s.corporation_id
GROUP BY co.code, s.date
ORDER BY s.date DESC, co.code;

-- B) Every capture today, one line each. Shows whether the sync is still running
--    (recent captured_at) and how the running total moved through the day.
SELECT co.code AS corp,
       lpad(s.hour::text,2,'0') || ':' || lpad(s.minute::text,2,'0') AS at,
       s.amount, s.captured_at
FROM public.revenue_snapshots s
JOIN public.corporations co ON co.id = s.corporation_id
WHERE s.date = CURRENT_DATE
ORDER BY co.code, s.hour, s.minute;

-- C) Is last week's same weekday present at all? (This is what the card needs.)
--    Expect 24 rows per Toast store (AD/BW/FH) once the backfill has run.
SELECT co.code AS corp, count(*) AS rows_for_last_week_same_day
FROM public.corporations co
LEFT JOIN public.revenue_snapshots s
       ON s.corporation_id = co.id AND s.date = CURRENT_DATE - 7
GROUP BY co.code ORDER BY co.code;

-- D) Sanity: is revenue actually moving today? If the running total is flat, the
--    sync IS working and simply had nothing new to record.
SELECT co.code AS corp, ROUND(sum(r.amount),2) AS todays_revenue_in_db
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
WHERE r.date = CURRENT_DATE
GROUP BY co.code ORDER BY co.code;
