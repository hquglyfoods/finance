-- ============================================================================
-- HQ 2026-06: app revenue is 42,918.77 but the Excel June total is 53,158.77.
-- Missing: exactly 10,240.00 (Ingredients sale on JUNE 28, skipped by the
-- board import).
--
-- v2: daily_revenue has a UNIQUE (corporation_id, channel_id, date) constraint
-- and a row ALREADY EXISTS at (HQ, Ingredients, 2026-06-28). June revenue is
-- board-locked, so that non-board row is excluded from the total. The fix is
-- therefore an UPDATE of that row (amount 10,240.00, source 'board'), not an
-- INSERT.
--
-- Run the whole file. Step 1 and Step 3 are checks; paste them if anything
-- looks off.
-- ============================================================================

-- 1) SHOW the existing June 28 row that blocked the insert.
SELECT r.date, ch.name AS channel, r.amount AS current_amount, r.source AS current_source
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'HQ'
LEFT JOIN public.revenue_channels ch ON ch.id = r.channel_id
WHERE r.date = '2026-06-28';


-- 2) UPDATE it to the Excel value. Channel resolved from the June 12 board row
--    (Ingredients, 10,729.00), so this touches exactly the right channel.
UPDATE public.daily_revenue r
SET amount = 10240.00, source = 'board'
FROM public.corporations co,
     (SELECT r2.channel_id
        FROM public.daily_revenue r2
        JOIN public.corporations c2 ON c2.id = r2.corporation_id AND c2.code = 'HQ'
       WHERE r2.date = '2026-06-12' AND r2.source = 'board' AND r2.amount = 10729.00
       LIMIT 1) anchor
WHERE co.id = r.corporation_id AND co.code = 'HQ'
  AND r.channel_id = anchor.channel_id
  AND r.date = '2026-06-28'
RETURNING r.date, r.amount AS new_amount, r.source AS new_source;


-- 3) VERIFY: the app counts only board rows in a locked month, so recompute
--    the locked June total. Must be 53,158.77.
SELECT sum(r.amount) AS june_board_total_should_be_53158_77
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'HQ'
WHERE r.source = 'board'
  AND r.date >= '2026-06-01' AND r.date < '2026-07-01';
