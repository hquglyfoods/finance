-- ============================================================================
-- HQ 2026-06: app revenue is 42,918.77 but the Excel June total is 53,158.77.
-- Missing: exactly 10,240.00.
--
-- Cause: the Excel June tab has an Ingredients sale of 10,240.00 on JUNE 28
-- that the board import skipped. Same failure date as the FH June 28 expense
-- gap fixed earlier, this time on the revenue side.
--
-- The channel id is resolved from the existing June 12 board row (10,729.00),
-- which is the same Ingredients channel, so no hardcoded ids.
--
-- Run the whole file. Step 1 and Step 3 are checks; paste them if anything
-- looks off.
-- ============================================================================

-- 1) CONFIRM the gap and that no 6/28 board revenue exists yet.
SELECT
  sum(r.amount)                    AS june_in_db,          -- expect 42918.77
  53158.77                         AS june_in_excel,
  53158.77 - sum(r.amount)         AS missing,             -- expect 10240.00
  count(*) FILTER (WHERE r.date = '2026-06-28' AND r.source = 'board')
                                   AS june28_board_rows    -- expect 0
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
WHERE co.code = 'HQ'
  AND r.date >= '2026-06-01' AND r.date < '2026-07-01';


-- 2) INSERT the missing June 28 Ingredients revenue.
--    Channel resolved from the June 12 board row (Ingredients, 10,729.00).
INSERT INTO public.daily_revenue (corporation_id, channel_id, date, amount, source)
SELECT r.corporation_id, r.channel_id, DATE '2026-06-28', 10240.00, 'board'
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
WHERE co.code = 'HQ'
  AND r.date = '2026-06-12'
  AND r.source = 'board'
  AND r.amount = 10729.00
LIMIT 1;


-- 3) VERIFY: June must now total 53,158.77
SELECT sum(r.amount) AS june_total_should_be_53158_77
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
WHERE co.code = 'HQ'
  AND r.date >= '2026-06-01' AND r.date < '2026-07-01';
