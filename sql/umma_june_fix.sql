-- ============================================================================
-- UMMA June 2026 revenue: 3,986.00 is missing.
--
--   Excel June total          6,340.00
--   In the database           2,354.00   (inventory rows, 6/27 - 6/30 only)
--   Missing (June 1 - 26)     3,986.00
--
-- Why: UMMA revenue used to be entered as ONE manual row at month end (4/30, 5/31).
-- The inventory integration started auto-creating revenue on 6/27. Nobody entered the
-- first 26 days of June, and the integration was not running yet, so that period is blank.
--
-- NOTE: from July onward the inventory integration creates UMMA revenue automatically.
-- Do NOT also key in a month-end figure by hand, or it will be counted twice.
-- ============================================================================

-- 1) CONFIRM the gap.
SELECT
  sum(r.amount)             AS june_in_db,       -- expect 2354.00
  6340.00                   AS june_in_excel,
  6340.00 - sum(r.amount)   AS missing            -- expect 3986.00
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
WHERE co.code = 'UMMA'
  AND r.date >= '2026-06-01' AND r.date < '2026-07-01';


-- 2) INSERT the missing June 1-26 revenue.
--    Dated 2026-06-26, the last uncovered day, so it cannot collide with the
--    inventory rows that begin on 6/27.
INSERT INTO public.daily_revenue (corporation_id, channel_id, date, amount, source)
VALUES (
  (SELECT id FROM public.corporations WHERE code = 'UMMA'),
  (SELECT id FROM public.revenue_channels
     WHERE corporation_id = (SELECT id FROM public.corporations WHERE code = 'UMMA')
       AND code = 'ugly' LIMIT 1),
  DATE '2026-06-26',
  3986.00,
  'manual'
);


-- 3) VERIFY: June must now total 6,340.00
SELECT sum(r.amount) AS june_total_should_be_6340
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
WHERE co.code = 'UMMA'
  AND r.date >= '2026-06-01' AND r.date < '2026-07-01';


-- 4) HOUSEKEEPING: a zero-amount revenue row sits on 2026-07-07. It changes no total,
--    but it is noise. Uncomment to remove.
-- DELETE FROM public.daily_revenue r
--  USING public.corporations co
--  WHERE co.id = r.corporation_id AND co.code = 'UMMA'
--    AND r.date = '2026-07-07' AND r.amount = 0;
