-- ============================================================================
-- FULL RECONCILIATION AUDIT  (all corps, all months)
--
-- HOW THE APP DECIDES WHAT COUNTS, per month:
--
--   A past month is "Excel-locked" on a side (revenue / expenses) if that side has any
--   source='board' rows. On a locked side:
--
--     board        COUNTED   (the Excel)
--     slack        dropped   (superseded by the Excel)
--     toast        dropped
--     inventory    dropped
--     payroll_bot  dropped   ONLY when the Excel carries payroll
--     manual       COUNTED   <-- still added ON TOP of the Excel
--     recurring    COUNTED   <-- still added ON TOP of the Excel
--     cash_ledger  COUNTED   <-- still added ON TOP of the Excel
--
--   So if a fixed cost (rent, utilities) is BOTH in the Excel AND set up as a recurring
--   expense, the app counts it TWICE. That is the prime suspect for the app being higher
--   than the Excel.
--
--   And if the Excel is missing rows, the app is LOWER than the Excel.
--
-- Run every block. Block 2 is the headline.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) THE PRIME SUSPECT: in an Excel-locked month, what is being added ON TOP
--    of the Excel? Any row here is a candidate for double counting.
-- ---------------------------------------------------------------------------
WITH e AS (
  SELECT ex.corporation_id, co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
         ex.source, ex.amount, ex.memo, c.name AS category
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = ex.category_id
  WHERE ex.status = 'confirmed'
),
lock AS (
  SELECT corp, month, bool_or(source='board') AS excel_month FROM e GROUP BY corp, month
)
SELECT e.corp, e.month, e.source, e.category,
       count(*)      AS rows,
       sum(e.amount) AS added_on_top_of_excel
FROM e JOIN lock l USING (corp, month)
WHERE l.excel_month                                  -- the Excel covers this month
  AND e.source IN ('manual','recurring','cash_ledger','import')   -- ...but these still count
GROUP BY e.corp, e.month, e.source, e.category
ORDER BY e.month DESC, e.corp, added_on_top_of_excel DESC;


-- ---------------------------------------------------------------------------
-- 2) HEADLINE: app revenue and app expenses, per corp per month.
--    Put these side by side with the Excel.
-- ---------------------------------------------------------------------------
WITH e AS (
  SELECT ex.corporation_id, co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
         ex.source, ex.amount, c.code AS cat_code
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = ex.category_id
  WHERE ex.status='confirmed'
),
elock AS (SELECT corp, month, bool_or(source='board') AS locked FROM e GROUP BY corp, month),
exp AS (
  SELECT e.corp, e.month,
    sum(e.amount) FILTER (
      WHERE e.cat_code IS NOT NULL
        AND NOT (l.locked AND e.source <> 'board'
                 AND e.source IN ('slack','toast','inventory','payroll_bot'))
    ) AS app_expenses
  FROM e JOIN elock l USING (corp, month)
  GROUP BY e.corp, e.month
),
r AS (
  SELECT co.code AS corp, to_char(dr.date,'YYYY-MM') AS month,
         dr.source, dr.amount, ch.counts_in_total, ch.total_multiplier
  FROM public.daily_revenue dr
  JOIN public.corporations co ON co.id = dr.corporation_id
  LEFT JOIN public.revenue_channels ch ON ch.id = dr.channel_id
),
rlock AS (SELECT corp, month, bool_or(source='board') AS locked FROM r GROUP BY corp, month),
rev AS (
  SELECT r.corp, r.month,
    sum(r.amount * COALESCE(r.total_multiplier,1)) FILTER (
      WHERE r.counts_in_total
        AND NOT (l.locked AND r.source <> 'board')
    ) AS app_revenue
  FROM r JOIN rlock l USING (corp, month)
  GROUP BY r.corp, r.month
)
SELECT COALESCE(rev.corp, exp.corp)   AS corp,
       COALESCE(rev.month, exp.month) AS month,
       rev.app_revenue,
       exp.app_expenses,
       COALESCE(rev.app_revenue,0) - COALESCE(exp.app_expenses,0) AS app_net
FROM rev FULL OUTER JOIN exp ON rev.corp=exp.corp AND rev.month=exp.month
WHERE COALESCE(rev.month, exp.month) >= '2026-01'
ORDER BY corp, month;


-- ---------------------------------------------------------------------------
-- 3) UMMA + HQ detail: every expense row, by month and category, with its source.
--    This is what you line up against the Excel, row by row.
-- ---------------------------------------------------------------------------
SELECT co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
       c.name AS category, ex.source,
       count(*) AS rows, sum(ex.amount) AS total
FROM public.expenses ex
JOIN public.corporations co ON co.id = ex.corporation_id
LEFT JOIN public.expense_categories c ON c.id = ex.category_id
WHERE co.code IN ('UMMA','HQ')
  AND ex.status='confirmed'
  AND ex.date >= '2026-01-01' AND ex.date < '2026-07-01'
GROUP BY corp, month, category, ex.source
ORDER BY corp, month, category, ex.source;


-- ---------------------------------------------------------------------------
-- 4) ORPHANS: rows whose category or channel link is broken. These disappear
--    from every total with no warning.
-- ---------------------------------------------------------------------------
SELECT 'expense' AS kind, co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
       count(*) AS rows, sum(ex.amount) AS lost
FROM public.expenses ex
JOIN public.corporations co ON co.id = ex.corporation_id
LEFT JOIN public.expense_categories c
       ON c.id = ex.category_id AND c.corporation_id = ex.corporation_id
WHERE ex.status='confirmed' AND c.id IS NULL
GROUP BY corp, month
UNION ALL
SELECT 'revenue', co.code, to_char(dr.date,'YYYY-MM'), count(*), sum(dr.amount)
FROM public.daily_revenue dr
JOIN public.corporations co ON co.id = dr.corporation_id
LEFT JOIN public.revenue_channels ch
       ON ch.id = dr.channel_id AND ch.corporation_id = dr.corporation_id
WHERE ch.id IS NULL
GROUP BY co.code, to_char(dr.date,'YYYY-MM')
ORDER BY 1,2,3;


-- ---------------------------------------------------------------------------
-- 5) Which recurring expenses are configured? These post automatically every month
--    and are the usual source of double counting against the Excel.
-- ---------------------------------------------------------------------------
SELECT co.code AS corp, c.name AS category, re.amount, re.day_of_month, re.active, re.memo
FROM public.recurring_expenses re
JOIN public.corporations co ON co.id = re.corporation_id
LEFT JOIN public.expense_categories c ON c.id = re.category_id
ORDER BY co.code, re.amount DESC;
