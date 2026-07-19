-- ============================================================================
-- REPAIR: two stray cash-count values from the store-switching bug.
--
--   (1) BW 2026-07-05 counted_amount = 346  -> belongs to AD, misfiled onto BW.
--   (2) AD 2026-07-06 count_note = 'Fernanda' -> not a real shortage note
--        (that day was OVER, 627 counted vs 616 sales), so the note is cleared.
--
-- Run STEP 0 first and read it. It shows exactly what will change. Only run the
-- STEP 1 / STEP 2 updates once STEP 0 looks right. Each update targets one store,
-- one date, one channel, so nothing else can be touched.
-- ============================================================================

-- ---------- STEP 0: preview (read-only) ----------
-- BW July 5 as it stands now: is there real cash on this day, or only the stray count?
SELECT 'BW 2026-07-05 now' AS what, co.code AS store, dr.date,
       dr.amount AS cash_sales, dr.counted_amount, dr.count_note, dr.verified
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code='cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE co.code='BW' AND dr.date='2026-07-05'
UNION ALL
SELECT 'AD 2026-07-06 now', co.code, dr.date, dr.amount, dr.counted_amount, dr.count_note, dr.verified
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code='cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE co.code='AD' AND dr.date='2026-07-06';


-- ---------- STEP 1: clear the misfiled BW count ----------
-- Removes ONLY the stray counted_amount on BW July 5. The row and its real cash
-- sales (if any) are kept. If STEP 0 shows BW July 5 has 0 sales and no other
-- data, you may instead delete the row entirely (see the optional DELETE below).
UPDATE public.daily_revenue dr
SET counted_amount = NULL
FROM public.revenue_channels rc, public.corporations co
WHERE dr.channel_id = rc.id AND rc.code='cash'
  AND dr.corporation_id = co.id AND co.code='BW'
  AND dr.date='2026-07-05'
  AND dr.counted_amount = 346;

-- OPTIONAL, only if STEP 0 showed BW July 5 has amount 0/NULL and no note and is
-- not verified (i.e. the row exists only because of the stray count):
-- DELETE FROM public.daily_revenue dr
-- USING public.revenue_channels rc, public.corporations co
-- WHERE dr.channel_id = rc.id AND rc.code='cash'
--   AND dr.corporation_id = co.id AND co.code='BW'
--   AND dr.date='2026-07-05'
--   AND (dr.amount IS NULL OR dr.amount=0)
--   AND dr.count_note IS NULL
--   AND dr.verified IS NOT TRUE;


-- ---------- STEP 2: clear the stray 'Fernanda' note ----------
-- Leaves AD July 6's real sales and counted_amount (627) intact; clears only the note.
UPDATE public.daily_revenue dr
SET count_note = NULL
FROM public.revenue_channels rc, public.corporations co
WHERE dr.channel_id = rc.id AND rc.code='cash'
  AND dr.corporation_id = co.id AND co.code='AD'
  AND dr.date='2026-07-06'
  AND dr.count_note='Fernanda';


-- ---------- STEP 3: verify the fixes (read-only) ----------
SELECT 'after' AS state, co.code AS store, dr.date,
       dr.amount AS cash_sales, dr.counted_amount, dr.count_note
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code='cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE (co.code='BW' AND dr.date='2026-07-05')
   OR (co.code='AD' AND dr.date='2026-07-06')
ORDER BY co.code, dr.date;

-- Re-run check 7 from the audit: should now return NO rows.
SELECT dr.date, dr.counted_amount,
       string_agg(co.code, ', ' ORDER BY co.code) AS stores
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code='cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE dr.counted_amount IS NOT NULL
GROUP BY dr.date, dr.counted_amount
HAVING count(DISTINCT dr.corporation_id) > 1
ORDER BY dr.date;
