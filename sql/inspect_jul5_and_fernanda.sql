-- ============================================================================
-- INSPECT the two suspicious findings before touching anything. Read-only.
-- Paste all results back.
-- ============================================================================

-- 1) July 5: the full cash row for EACH store, so we can tell which 346 is real.
--    Compare counted_amount against that store's actual cash sales and expected
--    amount. The store whose sales/expected are nowhere near 346 is the misfiled one.
SELECT co.code AS store, dr.date,
       dr.amount        AS cash_sales,
       dr.counted_amount,
       dr.count_note,
       dr.verified,
       dr.pickup_id
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.date = '2026-07-05'
ORDER BY co.code;

-- 2) For context, each of those stores' cash sales for the days AROUND July 5,
--    so you can see what a normal count looks like there and judge if 346 fits.
SELECT co.code AS store, dr.date, dr.amount AS cash_sales, dr.counted_amount, dr.count_note
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.date BETWEEN '2026-07-01' AND '2026-07-09'
  AND co.code IN ('AD','BW')
ORDER BY co.code, dr.date;

-- 3) The "Fernanda" note in full: which store, date, amount, and whether that day
--    was actually short (a real note) or not (likely a test).
SELECT co.code AS store, dr.date, dr.amount AS cash_sales,
       dr.counted_amount, dr.count_note, dr.verified
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.count_note = 'Fernanda';
