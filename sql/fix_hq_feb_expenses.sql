-- ============================================================================
-- HQ 2026-02 EXPENSES rebuild.
--
-- The DB's February board expenses total 76,996.89, which is March's figure
-- (imported while the Excel board's February column pointed at the March tab).
-- True February, rebuilt from the 2026-02 tab plus the board's own fixed rows
-- and formulas:
--
--   daily  Payroll 10,000.00 + Supplies Food 19,294.08 + Others 5,035.74
--   fixed  Lease 6,006.00 + Utilities 100.00 + Mortgage/Loan 7,846.00
--          + Other Obligations 1,480.03  (= 10,000*13% + 6,001.11*3%)
--   TOTAL  49,761.85
--
-- Plan: delete ALL February board expense rows, then insert the true rows.
-- Safe because the current reconcile proves no non-board row contributes to
-- February (app total equals the board sum exactly), so nothing user-entered
-- is touched.
--
-- Category ids are resolved from MARCH's per-category board sums, which are
-- all distinct (25,000 / 24,071.26 / 10,681.41 / 6,006 / 100 / 7,846 /
-- 3,292.22), so no hardcoded ids and no name guessing.
--
-- Guards:
--   * Step 2 deletes ONLY if February board expenses still total 76,996.89.
--   * Step 3 inserts ONLY if no February board expense rows exist (i.e. the
--     delete ran). Run twice by accident and it does nothing.
--
-- Run the whole file top to bottom. Step 1 previews; paste it if the total is
-- not 76,996.89 or the category map is not 7 rows.
-- ============================================================================

-- 1a) PREVIEW: current February board expenses per category. Total must be 76,996.89.
SELECT c.name AS category, ROUND(sum(e.amount),2) AS feb_sum, count(*) AS rows
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id AND co.code = 'HQ'
LEFT JOIN public.expense_categories c
  ON c.id = e.category_id AND c.corporation_id = e.corporation_id
WHERE e.source = 'board' AND e.status = 'confirmed'
  AND e.date >= '2026-02-01' AND e.date < '2026-03-01'
GROUP BY ROLLUP (c.name)
ORDER BY c.name NULLS LAST;

-- 1b) PREVIEW: the category map resolved from March sums. Expect exactly 7 rows,
--     each with a category id.
WITH cat AS (
  SELECT e.category_id, ROUND(sum(e.amount),2) AS mar_sum
  FROM public.expenses e
  JOIN public.corporations co ON co.id = e.corporation_id AND co.code = 'HQ'
  WHERE e.source = 'board' AND e.status = 'confirmed'
    AND e.date >= '2026-03-01' AND e.date < '2026-04-01'
  GROUP BY e.category_id
)
SELECT m.label, m.category_id, c.name
FROM (
  SELECT 'payroll'           AS label, category_id FROM cat WHERE mar_sum = 25000.00
  UNION ALL SELECT 'supplies_food',    category_id FROM cat WHERE mar_sum = 24071.26
  UNION ALL SELECT 'others',           category_id FROM cat WHERE mar_sum = 10681.41
  UNION ALL SELECT 'lease',            category_id FROM cat WHERE mar_sum = 6006.00
  UNION ALL SELECT 'utilities',        category_id FROM cat WHERE mar_sum = 100.00
  UNION ALL SELECT 'mortgage',         category_id FROM cat WHERE mar_sum = 7846.00
  UNION ALL SELECT 'obligations',      category_id FROM cat WHERE mar_sum = 3292.22
) m
LEFT JOIN public.expense_categories c ON c.id = m.category_id
ORDER BY m.label;


-- 2) DELETE the stale February board expenses. Runs only while they still
--    total exactly 76,996.89.
DELETE FROM public.expenses e
USING public.corporations co
WHERE co.id = e.corporation_id AND co.code = 'HQ'
  AND e.source = 'board' AND e.status = 'confirmed'
  AND e.date >= '2026-02-01' AND e.date < '2026-03-01'
  AND (SELECT ROUND(sum(e2.amount),2)
         FROM public.expenses e2
        WHERE e2.corporation_id = co.id
          AND e2.source = 'board' AND e2.status = 'confirmed'
          AND e2.date >= '2026-02-01' AND e2.date < '2026-03-01') = 76996.89
RETURNING e.date, e.amount;


-- 3) INSERT the true February rows (17 daily from the 2026-02 tab + 4 fixed).
--    Runs only if February currently has NO board expense rows.
WITH cat AS (
  SELECT e.category_id, ROUND(sum(e.amount),2) AS mar_sum
  FROM public.expenses e
  JOIN public.corporations co ON co.id = e.corporation_id AND co.code = 'HQ'
  WHERE e.source = 'board' AND e.status = 'confirmed'
    AND e.date >= '2026-03-01' AND e.date < '2026-04-01'
  GROUP BY e.category_id
),
map AS (
  SELECT 'payroll'           AS label, category_id FROM cat WHERE mar_sum = 25000.00
  UNION ALL SELECT 'supplies_food',    category_id FROM cat WHERE mar_sum = 24071.26
  UNION ALL SELECT 'others',           category_id FROM cat WHERE mar_sum = 10681.41
  UNION ALL SELECT 'lease',            category_id FROM cat WHERE mar_sum = 6006.00
  UNION ALL SELECT 'utilities',        category_id FROM cat WHERE mar_sum = 100.00
  UNION ALL SELECT 'mortgage',         category_id FROM cat WHERE mar_sum = 7846.00
  UNION ALL SELECT 'obligations',      category_id FROM cat WHERE mar_sum = 3292.22
),
feb(label, d, amt) AS (VALUES
  -- daily rows, straight from the 2026-02 tab
  ('payroll',       DATE '2026-02-01', 2500.00),
  ('others',        DATE '2026-02-01', 3342.61),
  ('others',        DATE '2026-02-03', 140.33),
  ('others',        DATE '2026-02-04', 10.00),
  ('others',        DATE '2026-02-07', 385.25),
  ('payroll',       DATE '2026-02-08', 2500.00),
  ('supplies_food', DATE '2026-02-08', 4934.55),
  ('payroll',       DATE '2026-02-15', 2500.00),
  ('supplies_food', DATE '2026-02-15', 3400.68),
  ('others',        DATE '2026-02-15', 45.64),
  ('others',        DATE '2026-02-17', 17.80),
  ('others',        DATE '2026-02-19', 56.09),
  ('supplies_food', DATE '2026-02-21', 5160.18),
  ('payroll',       DATE '2026-02-22', 2500.00),
  ('others',        DATE '2026-02-22', 1000.00),
  ('supplies_food', DATE '2026-02-27', 5798.67),
  ('others',        DATE '2026-02-27', 38.02),
  -- fixed monthly rows
  ('lease',         DATE '2026-02-28', 6006.00),
  ('utilities',     DATE '2026-02-28', 100.00),
  ('mortgage',      DATE '2026-02-28', 7846.00),
  ('obligations',   DATE '2026-02-28', 1480.03)
)
INSERT INTO public.expenses (corporation_id, category_id, date, amount, source, status, memo)
SELECT co.id, m.category_id, f.d, f.amt, 'board', 'confirmed',
       'Feb 2026 rebuilt from closing tab (board column had referenced March)'
FROM feb f
JOIN map m USING (label)
CROSS JOIN public.corporations co
WHERE co.code = 'HQ'
  AND NOT EXISTS (
    SELECT 1 FROM public.expenses e2
    WHERE e2.corporation_id = co.id
      AND e2.source = 'board' AND e2.status = 'confirmed'
      AND e2.date >= '2026-02-01' AND e2.date < '2026-03-01')
RETURNING date, amount;


-- 4) VERIFY: February must now total 49,761.85 under the app's locked-month rule.
WITH ex AS (
  SELECT e.source, e.amount, c.code AS cat_code
  FROM public.expenses e
  JOIN public.corporations co ON co.id = e.corporation_id AND co.code = 'HQ'
  LEFT JOIN public.expense_categories c
    ON c.id = e.category_id AND c.corporation_id = e.corporation_id
  WHERE e.status = 'confirmed'
    AND e.date >= '2026-02-01' AND e.date < '2026-03-01'
),
f AS (
  SELECT bool_or(source='board') AS locked,
         bool_or(source='board' AND cat_code IN ('payroll','payroll_tax')) AS has_pay
  FROM ex
)
SELECT ROUND(sum(ex.amount) FILTER (
         WHERE ex.cat_code IS NOT NULL
           AND NOT (f.locked AND ex.source <> 'board' AND (
                 ex.source IN ('slack','toast','inventory','recurring')
                 OR (ex.source = 'payroll_bot' AND f.has_pay)))
       ), 2) AS feb_expenses_should_be_49761_85,
       count(*) FILTER (WHERE ex.source='board') AS board_rows_should_be_21
FROM ex CROSS JOIN f;
