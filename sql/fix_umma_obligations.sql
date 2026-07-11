-- ============================================================================
-- UMMA 2026: the app is HIGH by 78.00 (Jan), 91.00 (Feb), 104.00 (Mar),
-- 130.00 (May). April and June are exact.
--
-- Cause, proven: the board's "Other Obligations" row is payroll * 13% + Ugly
-- sales * 3%. The board import ran when payroll was 2,500 every month. John
-- later corrected the payroll rows in the app (1,900 / 1,800 / 1,700 / 1,500),
-- but the stored Other Obligations rows still carry the 2,500-based figure.
-- Every diff equals 0.13 * (2,500 - corrected payroll), to the cent:
--
--   month    payroll   0.13*(2500-p)   observed diff
--   2026-01    1,900        78.00           78.00
--   2026-02    1,800        91.00           91.00
--   2026-03    1,700       104.00          104.00
--   2026-05    1,500       130.00          130.00
--
-- Fix: subtract the delta from the Other Obligations board row of each month.
-- Deltas are applied relatively (amount - delta), so it lands exactly on the
-- Excel total no matter how the stored value was rounded.
--
-- Run Step 1 first and check it returns exactly 4 rows with amounts near
-- 428.04 / 422.04 / 445.13 / 470.59. Then run Step 2 and Step 3.
-- ============================================================================

-- 1) PREVIEW the rows that will be changed. Expect 4 rows.
WITH adj(month, delta) AS (VALUES
  ('2026-01', 78.00), ('2026-02', 91.00), ('2026-03', 104.00), ('2026-05', 130.00)
)
SELECT a.month, c.name AS category, e.date, e.amount AS current_amount,
       e.amount - a.delta AS will_become, e.source
FROM adj a
JOIN public.corporations co ON co.code = 'UMMA'
JOIN public.expenses e
  ON e.corporation_id = co.id
 AND to_char(e.date,'YYYY-MM') = a.month
 AND e.source = 'board' AND e.status = 'confirmed'
JOIN public.expense_categories c
  ON c.id = e.category_id AND c.corporation_id = co.id
WHERE c.name ~* 'obligation'
ORDER BY a.month;


-- 2) APPLY. One row per month; if a month unexpectedly has several obligation
--    board rows, only the largest is touched, and the RETURNING output shows
--    exactly what changed.
WITH adj(month, delta) AS (VALUES
  ('2026-01', 78.00), ('2026-02', 91.00), ('2026-03', 104.00), ('2026-05', 130.00)
),
target AS (
  SELECT DISTINCT ON (a.month) e.id, a.month, a.delta
  FROM adj a
  JOIN public.corporations co ON co.code = 'UMMA'
  JOIN public.expenses e
    ON e.corporation_id = co.id
   AND to_char(e.date,'YYYY-MM') = a.month
   AND e.source = 'board' AND e.status = 'confirmed'
  JOIN public.expense_categories c
    ON c.id = e.category_id AND c.corporation_id = co.id
  WHERE c.name ~* 'obligation'
  ORDER BY a.month, e.amount DESC
)
UPDATE public.expenses e
SET amount = e.amount - t.delta
FROM target t
WHERE e.id = t.id
RETURNING t.month, e.amount + t.delta AS old_amount, e.amount AS new_amount, -t.delta AS applied;


-- 3) VERIFY: monthly expense totals must now equal the Excel.
--    Expect: 2026-01 19587.65 / 2026-02 8860.00 / 2026-03 8770.09 / 2026-05 9323.31
WITH ex AS (
  SELECT to_char(e.date,'YYYY-MM') AS month, e.source, e.amount, c.code AS cat_code
  FROM public.expenses e
  JOIN public.corporations co ON co.id = e.corporation_id AND co.code = 'UMMA'
  LEFT JOIN public.expense_categories c
    ON c.id = e.category_id AND c.corporation_id = e.corporation_id
  WHERE e.status = 'confirmed'
    AND e.date >= '2026-01-01' AND e.date < '2026-07-01'
),
f AS (
  SELECT month,
         bool_or(source='board') AS locked,
         bool_or(source='board' AND cat_code IN ('payroll','payroll_tax')) AS has_pay
  FROM ex GROUP BY month
)
SELECT e.month,
       ROUND(sum(e.amount) FILTER (
         WHERE e.cat_code IS NOT NULL
           AND NOT (f.locked AND e.source <> 'board' AND (
                 e.source IN ('slack','toast','inventory','recurring')
                 OR (e.source = 'payroll_bot' AND f.has_pay)))
       ), 2) AS app_expenses
FROM ex e JOIN f USING (month)
GROUP BY e.month ORDER BY e.month;
