-- ============================================================================
-- DIAGNOSTIC: why do old cash-count values reappear?
--
-- Read-only. Run each block, paste results. This looks for counted_amount /
-- count_note values that are lingering in daily_revenue: old test entries that
-- were "deleted" on screen but never actually removed from the database.
-- ============================================================================

-- A) EVERY cash day that currently has a counted_amount or a count_note, all
--    stores, all dates. This is the full picture of what is stored. Look for old
--    dates you thought were cleared, or test values.
SELECT co.code AS store, dr.date, dr.amount AS cash_sales,
       dr.counted_amount, dr.count_note, dr.verified
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.counted_amount IS NOT NULL OR dr.count_note IS NOT NULL
ORDER BY co.code, dr.date;

-- B) The same, but only OLDER than 14 days. A count is normally entered within a
--    few days of the pickup, so counts on old days are suspicious (likely test
--    leftovers). These are the prime candidates for the "old info reappearing".
SELECT co.code AS store, dr.date, dr.counted_amount, dr.count_note
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE (dr.counted_amount IS NOT NULL OR dr.count_note IS NOT NULL)
  AND dr.date < CURRENT_DATE - 14
ORDER BY co.code, dr.date;

-- C) counted_amount present but the row has ZERO cash sales. A count on a no-sale
--    day is almost always a stray test value (or a wrong-store save).
SELECT co.code AS store, dr.date, dr.amount AS cash_sales, dr.counted_amount, dr.count_note
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.counted_amount IS NOT NULL AND (dr.amount IS NULL OR dr.amount = 0)
ORDER BY co.code, dr.date;

-- D) count_note text, grouped, so obvious test strings ("test", "aaa", "asdf",
--    numbers you typed while trying it out) are easy to spot.
SELECT dr.count_note, count(*) AS times, string_agg(DISTINCT co.code, ', ') AS stores
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.count_note IS NOT NULL
GROUP BY dr.count_note
ORDER BY times DESC, dr.count_note;
