-- ============================================================================
-- CASH DATA INTEGRITY AUDIT
--
-- The Cash tab had a store-switching bug that could show one store's data while
-- another was selected. If a pickup was SAVED in that state, it may have written
-- to the wrong store. These checks find any such damage. All of them should
-- return ZERO rows on healthy data. Run each block and paste back anything that
-- comes up.
--
-- Nothing here changes data; it only reports.
-- ============================================================================

-- 1) CROSS-STORE PICKUP LINKS  (the most serious case)
--    A daily_revenue row verified by a pickup that belongs to a DIFFERENT store.
--    The bug could have let a BW pickup verify AD days, etc. Expect ZERO rows.
SELECT dr.corporation_id AS revenue_store, cp.corporation_id AS pickup_store,
       dr.date, dr.amount, dr.pickup_id, cp.pickup_date, cp.period_start, cp.period_end
FROM public.daily_revenue dr
JOIN public.cash_pickups cp ON cp.id = dr.pickup_id
WHERE dr.corporation_id <> cp.corporation_id
ORDER BY dr.date;

-- 2) VERIFIED DATES OUTSIDE THE PICKUP PERIOD
--    A day marked verified by a pickup, but its date is not within that pickup's
--    period. A mismatched save could produce this. Expect ZERO rows.
SELECT co.code AS store, dr.date, cp.id AS pickup_id, cp.period_start, cp.period_end
FROM public.daily_revenue dr
JOIN public.cash_pickups cp ON cp.id = dr.pickup_id
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.date < cp.period_start OR dr.date > cp.period_end
ORDER BY co.code, dr.date;

-- 3) COUNTED AMOUNT / NOTE ON A NON-CASH ROW
--    counted_amount and count_note belong only to the cash channel. If the mixup
--    wrote them onto another channel's row, they show here. Expect ZERO rows.
SELECT co.code AS store, rc.name AS channel, dr.date,
       dr.counted_amount, dr.count_note
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE (dr.counted_amount IS NOT NULL OR dr.count_note IS NOT NULL)
  AND rc.code <> 'cash'
ORDER BY co.code, dr.date;

-- 4) PICKUP TOTAL vs THE DAYS IT VERIFIES
--    For each pickup, compare its recorded counted_amount to the cash sales of the
--    days it verifies. A large gap can flag a pickup that swept the wrong store's
--    days. Review anything where the difference looks wrong (small diffs are normal:
--    a pickup may count physical cash that differs from recorded sales).
SELECT co.code AS store, cp.id AS pickup_id, cp.period_start, cp.period_end,
       cp.counted_amount AS pickup_counted,
       ROUND(SUM(dr.amount), 2) AS sum_of_verified_days,
       ROUND(cp.counted_amount - SUM(dr.amount), 2) AS difference
FROM public.cash_pickups cp
JOIN public.corporations co ON co.id = cp.corporation_id
LEFT JOIN public.daily_revenue dr
       ON dr.pickup_id = cp.id AND dr.corporation_id = cp.corporation_id
GROUP BY co.code, cp.id, cp.period_start, cp.period_end, cp.counted_amount
ORDER BY co.code, cp.period_start;

-- 5) RECENTLY VERIFIED DAYS, for a human eyeball
--    Lists cash days verified in the last 60 days with their store, so you can scan
--    for anything that looks off (a store you did not do a pickup for, etc.).
SELECT co.code AS store, dr.date, dr.amount, dr.counted_amount, dr.verified,
       dr.verified_at, dr.pickup_id
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.verified = true AND dr.date >= CURRENT_DATE - 60
ORDER BY dr.verified_at DESC NULLS LAST, co.code, dr.date;


-- ============================================================================
-- ADDED: the Cash tab saves on blur (no Save button), so counted_amount and
-- count_note write immediately using the then-selected store. If the store was
-- wrong at that instant, the value landed on the wrong store's day. These two
-- checks surface counts/notes that look out of place.
-- ============================================================================

-- 6) COUNTED CASH on a day that had NO cash sale.
--    Entering a count on a day the store recorded no cash is a strong signal the
--    value was typed while the wrong store was active. Review each row: is this a
--    real day for this store, or does the amount match a DIFFERENT store's day?
SELECT co.code AS store, dr.date, dr.amount AS cash_sales, dr.counted_amount, dr.count_note
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.counted_amount IS NOT NULL
  AND (dr.amount IS NULL OR dr.amount = 0)
ORDER BY co.code, dr.date;

-- 7) SAME COUNT VALUE on the SAME DATE across TWO stores.
--    If a count meant for one store was saved onto another, the identical amount
--    can appear on the same date under two stores. Worth a look. (Coincidental
--    equal counts are possible but uncommon.)
SELECT dr.date, dr.counted_amount,
       string_agg(co.code, ', ' ORDER BY co.code) AS stores
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code = 'cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.counted_amount IS NOT NULL
GROUP BY dr.date, dr.counted_amount
HAVING count(DISTINCT dr.corporation_id) > 1
ORDER BY dr.date;
