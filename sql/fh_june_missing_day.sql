-- ============================================================================
-- FIX: the Excel (board) import for FH 2026-06 is MISSING 2026-06-28 entirely.
--
--   Excel payroll : 3,964.16 (7th) + 3,755.35 (14th) + 4,388.66 (21st) + 3,913.20 (28th)
--                 = 16,021.37
--   In the DB     : only the first three  = 12,108.17
--   Missing       : payroll  3,913.20   AND   supplies  884.50   (both dated 2026-06-28)
--                 = 4,797.70
--
--   board total 47,699.28 + 4,797.70 = 52,496.98  <- exactly the real cost.
--
-- The cleanest fix is to RE-RUN the Excel import for FH June, which will bring in the
-- missing day. Only insert manually (block C) if a re-import is not possible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) CONFIRM the gap: list every board expense date for FH June.
--    2026-06-28 should be absent.
-- ---------------------------------------------------------------------------
SELECT e.date, c.name AS category, e.amount, e.source
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
LEFT JOIN public.expense_categories c ON c.id = e.category_id
WHERE co.code = 'FH'
  AND e.source = 'board'
  AND e.date >= '2026-06-01' AND e.date < '2026-07-01'
ORDER BY e.date, c.name;

-- ---------------------------------------------------------------------------
-- B) CHECK EVERY OTHER MONTH/STORE for the same kind of gap: a board import that
--    is missing days. This compares the number of distinct board dates against the
--    days in the month that actually had sales.
-- ---------------------------------------------------------------------------
WITH rev_days AS (
  SELECT corporation_id, to_char(date,'YYYY-MM') AS month, count(DISTINCT date) AS sales_days
  FROM public.daily_revenue WHERE amount <> 0 GROUP BY 1,2
),
board_days AS (
  SELECT corporation_id, to_char(date,'YYYY-MM') AS month, count(DISTINCT date) AS board_dates
  FROM public.expenses WHERE source='board' AND status='confirmed' GROUP BY 1,2
)
SELECT co.code AS corp, b.month, b.board_dates, r.sales_days
FROM board_days b
JOIN rev_days r ON r.corporation_id=b.corporation_id AND r.month=b.month
JOIN public.corporations co ON co.id=b.corporation_id
ORDER BY b.month DESC, corp;

-- ---------------------------------------------------------------------------
-- C) MANUAL BACKFILL (only if you cannot re-run the import).
--    Inserts the two missing 2026-06-28 rows for FH as board rows, so the app treats
--    them exactly like the rest of the Excel data.
--    Review the category codes first - adjust if your codes differ.
-- ---------------------------------------------------------------------------
-- Look up the ids you need:
-- SELECT id, code, name FROM public.expense_categories
--  WHERE corporation_id = (SELECT id FROM public.corporations WHERE code='FH')
--  ORDER BY name;

-- INSERT INTO public.expenses (corporation_id, category_id, date, amount, memo, source, status)
-- SELECT
--   (SELECT id FROM public.corporations WHERE code='FH'),
--   (SELECT id FROM public.expense_categories
--      WHERE corporation_id=(SELECT id FROM public.corporations WHERE code='FH')
--        AND name = 'Payroll' LIMIT 1),
--   DATE '2026-06-28', 3913.20, 'Payroll (Excel 06/28)', 'board', 'confirmed';

-- INSERT INTO public.expenses (corporation_id, category_id, date, amount, memo, source, status)
-- SELECT
--   (SELECT id FROM public.corporations WHERE code='FH'),
--   (SELECT id FROM public.expense_categories
--      WHERE corporation_id=(SELECT id FROM public.corporations WHERE code='FH')
--        AND name = 'Supplies (Food)' LIMIT 1),
--   DATE '2026-06-28', 884.50, 'Supplies (Excel 06/28)', 'board', 'confirmed';

-- ---------------------------------------------------------------------------
-- D) VERIFY after the fix: FH June expenses should total 52,496.98
--    (board rows only; the ADP payroll_bot rows are now correctly suppressed by the app
--     because the sheet carries payroll.)
-- ---------------------------------------------------------------------------
SELECT sum(e.amount) AS board_total_should_be_52496_98
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
WHERE co.code='FH' AND e.source='board' AND e.status='confirmed'
  AND e.date >= '2026-06-01' AND e.date < '2026-07-01';
