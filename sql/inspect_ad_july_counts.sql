-- ============================================================================
-- The screenshots show AD carrying counted amounts on many early-July days
-- (274, 366, 404, 422, 346, 627, ...). If those were test entries, they are
-- still in the database. This lists every AD cash day in July with a count or
-- note, so you can confirm which are test values to remove. Read-only.
-- ============================================================================
SELECT co.code AS store, dr.date,
       to_char(dr.date,'Dy') AS dow,
       dr.amount        AS cash_sales,
       dr.counted_amount,
       (dr.counted_amount - dr.amount) AS diff,
       dr.count_note,
       dr.verified
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE co.code = 'AD'
  AND dr.date BETWEEN '2026-07-01' AND '2026-07-31'
  AND (dr.counted_amount IS NOT NULL OR dr.count_note IS NOT NULL)
ORDER BY dr.date;
