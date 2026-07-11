-- ============================================================================
-- UMMA 2026 Jan-Jun: full reconciliation against the Excel.
--
-- Excel (payroll already corrected):
--   month        1          2         3         4          5         6
--   SALES     3,434.50  3,234.61  4,004.22  3,579.35  4,853.00  6,340.00
--   EXPENSES 19,587.65  8,860.00  8,770.09 16,154.08  9,323.31 13,885.10
--     Lease     6,006.00 every month
--     Utilities   200.00 every month
--     Payroll   1,900 / 1,800 / 1,700 / 2,500 / 1,500 / 2,500
--     Supplies 10,363.00 /  -  /  -  /  -  /  -  / 1,955.34
--     Shipping    768.61 / 522.96 / 522.96 / 7,015.70 / 1,276.72 / 2,708.56
--     Other Obl   350.04 / 331.04 / 341.13 /   432.38 /   340.59 /   515.20
--
-- Run all four blocks and paste the output.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) EXPENSES: what is in the database, by month and category.
--    `counted` is what the app adds up; `all_rows` is everything present.
-- ---------------------------------------------------------------------------
WITH e AS (
  SELECT ex.*, c.code AS cat_code, c.name AS cat_name,
         to_char(ex.date,'YYYY-MM') AS month
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = ex.category_id
  WHERE co.code = 'UMMA'
    AND ex.date >= '2026-01-01' AND ex.date < '2026-07-01'
    AND ex.status = 'confirmed'
),
locked AS (   -- a past month whose EXPENSES came from the Excel is expense-locked
  SELECT month, bool_or(source='board') AS exp_locked FROM e GROUP BY month
)
SELECT
  e.month,
  COALESCE(e.cat_name,'(no category)') AS category,
  string_agg(DISTINCT e.source, ', ')  AS sources,
  sum(e.amount)                        AS all_rows,
  sum(e.amount) FILTER (
    WHERE NOT (l.exp_locked AND e.source <> 'board'
               AND e.source IN ('slack','toast','inventory'))
      AND e.cat_code IS NOT NULL
  )                                    AS counted_by_app
FROM e JOIN locked l USING (month)
GROUP BY e.month, category
ORDER BY e.month, category;


-- ---------------------------------------------------------------------------
-- 2) EXPENSE TOTALS per month  ->  compare straight to the Excel row above.
-- ---------------------------------------------------------------------------
WITH e AS (
  SELECT ex.*, c.code AS cat_code, to_char(ex.date,'YYYY-MM') AS month
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = ex.category_id
  WHERE co.code='UMMA' AND ex.date >= '2026-01-01' AND ex.date < '2026-07-01'
    AND ex.status='confirmed'
),
locked AS (SELECT month, bool_or(source='board') AS exp_locked FROM e GROUP BY month)
SELECT
  e.month,
  sum(e.amount) FILTER (
    WHERE NOT (l.exp_locked AND e.source <> 'board'
               AND e.source IN ('slack','toast','inventory'))
      AND e.cat_code IS NOT NULL
  ) AS app_expense_total,
  sum(e.amount) AS all_rows_in_db
FROM e JOIN locked l USING (month)
GROUP BY e.month
ORDER BY e.month;


-- ---------------------------------------------------------------------------
-- 3) REVENUE per month  ->  compare to the Excel SALES row.
-- ---------------------------------------------------------------------------
SELECT
  to_char(r.date,'YYYY-MM') AS month,
  string_agg(DISTINCT r.source, ', ') AS sources,
  sum(r.amount * COALESCE(ch.total_multiplier,1)) FILTER (WHERE ch.counts_in_total) AS app_sales,
  sum(r.amount) AS all_rows
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
LEFT JOIN public.revenue_channels ch ON ch.id = r.channel_id
WHERE co.code='UMMA' AND r.date >= '2026-01-01' AND r.date < '2026-07-01'
GROUP BY month
ORDER BY month;


-- ---------------------------------------------------------------------------
-- 4) ORPHANS: rows whose category/channel link is broken. These vanish from every
--    total with no warning, and are a classic reason the app is short.
-- ---------------------------------------------------------------------------
SELECT 'expense' AS kind, to_char(ex.date,'YYYY-MM') AS month,
       count(*) AS rows, sum(ex.amount) AS lost
FROM public.expenses ex
JOIN public.corporations co ON co.id = ex.corporation_id
LEFT JOIN public.expense_categories c
       ON c.id = ex.category_id AND c.corporation_id = ex.corporation_id
WHERE co.code='UMMA' AND ex.status='confirmed' AND c.id IS NULL
GROUP BY month
UNION ALL
SELECT 'revenue', to_char(r.date,'YYYY-MM'), count(*), sum(r.amount)
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
LEFT JOIN public.revenue_channels ch
       ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE co.code='UMMA' AND ch.id IS NULL
GROUP BY to_char(r.date,'YYYY-MM')
ORDER BY 1, 2;
