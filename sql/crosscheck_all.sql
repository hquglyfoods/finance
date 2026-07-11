-- ============================================================================
-- CROSS-CHECK AUDIT: every corporation, every month.
--
-- This replicates EXACTLY what the app computes, straight from the database, and then
-- flags anything that looks wrong. Run it whole and paste the output of each block.
--
-- THE APP'S RULES (replicated below):
--   A past month is Excel-locked on a side (revenue / expenses) if THAT SIDE has any
--   source='board' row. The two sides lock independently.
--
--   On a locked EXPENSE side:
--     board                          COUNTED  (the Excel is the source of truth)
--     slack / toast / inventory / recurring   dropped
--     payroll_bot                    dropped ONLY if the Excel carries payroll that month
--     manual / cash_ledger / anything else   COUNTED, ON TOP OF THE EXCEL
--
--   On a locked REVENUE side: only board rows count.
--
--   A row whose category/channel is missing is dropped silently.
--
-- So there are exactly three ways the app can disagree with the Excel:
--   (A) something is added ON TOP of the Excel   -> app too HIGH   (Block 2)
--   (B) the Excel import missed rows             -> app too LOW    (Block 4)
--   (C) a row is orphaned                        -> app too LOW    (Block 5)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1  HEADLINE: what the app shows for every corp / month.
--          Put this next to the Excel. Any row that differs is a finding.
-- ---------------------------------------------------------------------------
WITH ex AS (
  SELECT ex.corporation_id, co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
         ex.source, ex.amount, c.code AS cat_code
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c
         ON c.id = ex.category_id AND c.corporation_id = ex.corporation_id
  WHERE ex.status = 'confirmed'
),
ex_flags AS (
  SELECT corp, month,
         bool_or(source = 'board') AS exp_locked,
         bool_or(source = 'board' AND cat_code IN ('payroll','payroll_tax')) AS excel_has_payroll
  FROM ex GROUP BY corp, month
),
exp_total AS (
  SELECT e.corp, e.month,
         sum(e.amount) FILTER (
           WHERE e.cat_code IS NOT NULL
             AND NOT (
               f.exp_locked AND e.source <> 'board' AND (
                 e.source IN ('slack','toast','inventory','recurring')
                 OR (e.source = 'payroll_bot' AND f.excel_has_payroll)
               )
             )
         ) AS app_expenses
  FROM ex e JOIN ex_flags f USING (corp, month)
  GROUP BY e.corp, e.month
),
rv AS (
  SELECT co.code AS corp, to_char(r.date,'YYYY-MM') AS month,
         r.source, r.amount, ch.counts_in_total, ch.total_multiplier, ch.id AS ch_id
  FROM public.daily_revenue r
  JOIN public.corporations co ON co.id = r.corporation_id
  LEFT JOIN public.revenue_channels ch
         ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
),
rv_flags AS (SELECT corp, month, bool_or(source='board') AS rev_locked FROM rv GROUP BY corp, month),
rev_total AS (
  SELECT r.corp, r.month,
         sum(r.amount * COALESCE(r.total_multiplier,1)) FILTER (
           WHERE r.ch_id IS NOT NULL AND r.counts_in_total
             AND NOT (f.rev_locked AND r.source <> 'board')
         ) AS app_revenue
  FROM rv r JOIN rv_flags f USING (corp, month)
  GROUP BY r.corp, r.month
)
SELECT COALESCE(r.corp, e.corp)   AS corp,
       COALESCE(r.month, e.month) AS month,
       ROUND(COALESCE(r.app_revenue,0), 2)  AS app_revenue,
       ROUND(COALESCE(e.app_expenses,0), 2) AS app_expenses,
       ROUND(COALESCE(r.app_revenue,0) - COALESCE(e.app_expenses,0), 2) AS app_net
FROM rev_total r
FULL OUTER JOIN exp_total e ON r.corp = e.corp AND r.month = e.month
WHERE COALESCE(r.month, e.month) >= '2025-01'
ORDER BY corp, month;


-- ---------------------------------------------------------------------------
-- BLOCK 2  (A) DOUBLE-COUNT SUSPECTS: rows added ON TOP of the Excel.
--          In an Excel-locked month these still count. If the same cost is also in
--          the Excel, the app is too high by exactly this amount.
--          *** This is the most likely cause of the app being higher than the Excel. ***
-- ---------------------------------------------------------------------------
WITH ex AS (
  SELECT co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
         ex.source, ex.amount, ex.date, ex.memo, c.name AS category
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = ex.category_id
  WHERE ex.status = 'confirmed'
),
lock AS (SELECT corp, month, bool_or(source='board') AS excel_month FROM ex GROUP BY corp, month)
SELECT e.corp, e.month, e.category, e.source,
       count(*)                    AS rows,
       ROUND(sum(e.amount),2)      AS added_on_top,
       min(e.date)                 AS first_date,
       max(COALESCE(e.memo,''))    AS sample_memo
FROM ex e JOIN lock l USING (corp, month)
WHERE l.excel_month
  AND e.source NOT IN ('board','slack','toast','inventory','recurring','payroll_bot')
GROUP BY e.corp, e.month, e.category, e.source
ORDER BY added_on_top DESC;


-- ---------------------------------------------------------------------------
-- BLOCK 3  Is the SAME cost sitting in both the Excel and another source, in the
--          same month and category? That is a double count, near-certain.
-- ---------------------------------------------------------------------------
WITH ex AS (
  SELECT co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
         ex.source, ex.amount, c.name AS category
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = ex.category_id
  WHERE ex.status='confirmed'
)
SELECT corp, month, category,
       ROUND(sum(amount) FILTER (WHERE source='board'), 2) AS in_excel,
       ROUND(sum(amount) FILTER (WHERE source NOT IN ('board','slack','toast','inventory','recurring','payroll_bot')), 2) AS also_added,
       string_agg(DISTINCT source, ', ') FILTER (WHERE source NOT IN ('board','slack','toast','inventory','recurring','payroll_bot')) AS from_sources
FROM ex
GROUP BY corp, month, category
HAVING sum(amount) FILTER (WHERE source='board') IS NOT NULL
   AND sum(amount) FILTER (WHERE source NOT IN ('board','slack','toast','inventory','recurring','payroll_bot')) IS NOT NULL
ORDER BY also_added DESC;


-- ---------------------------------------------------------------------------
-- BLOCK 4  (B) EXCEL IMPORT GAPS: months where the Excel expense import skipped days
--          (this is how FH lost 2026-06-28). Fewer board dates than revenue days.
-- ---------------------------------------------------------------------------
WITH rev_days AS (
  SELECT corporation_id, to_char(date,'YYYY-MM') AS month, count(DISTINCT date) AS sales_days
  FROM public.daily_revenue WHERE amount <> 0 GROUP BY 1,2
),
board_days AS (
  SELECT corporation_id, to_char(date,'YYYY-MM') AS month, count(DISTINCT date) AS board_dates
  FROM public.expenses WHERE source='board' AND status='confirmed' GROUP BY 1,2
)
SELECT co.code AS corp, b.month, b.board_dates, r.sales_days,
       r.sales_days - b.board_dates AS gap
FROM board_days b
JOIN rev_days r ON r.corporation_id=b.corporation_id AND r.month=b.month
JOIN public.corporations co ON co.id=b.corporation_id
ORDER BY gap DESC, b.month DESC;


-- ---------------------------------------------------------------------------
-- BLOCK 5  (C) ORPHANS: category/channel link broken -> dropped from every total.
-- ---------------------------------------------------------------------------
SELECT 'expense' AS kind, co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
       count(*) AS rows, ROUND(sum(ex.amount),2) AS lost_amount
FROM public.expenses ex
JOIN public.corporations co ON co.id = ex.corporation_id
LEFT JOIN public.expense_categories c
       ON c.id = ex.category_id AND c.corporation_id = ex.corporation_id
WHERE ex.status='confirmed' AND c.id IS NULL
GROUP BY corp, month
UNION ALL
SELECT 'revenue', co.code, to_char(r.date,'YYYY-MM'), count(*), ROUND(sum(r.amount),2)
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
LEFT JOIN public.revenue_channels ch
       ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE ch.id IS NULL
GROUP BY co.code, to_char(r.date,'YYYY-MM')
ORDER BY 1,2,3;


-- ---------------------------------------------------------------------------
-- BLOCK 6  Non-confirmed expenses sitting in past months. The app never counts
--          these, so if the Excel includes them, the app is short.
-- ---------------------------------------------------------------------------
SELECT co.code AS corp, to_char(ex.date,'YYYY-MM') AS month, ex.status,
       count(*) AS rows, ROUND(sum(ex.amount),2) AS not_counted
FROM public.expenses ex
JOIN public.corporations co ON co.id = ex.corporation_id
WHERE ex.status <> 'confirmed'
GROUP BY corp, month, ex.status
ORDER BY not_counted DESC;


-- ---------------------------------------------------------------------------
-- BLOCK 7  Recurring expenses configured. These post every month automatically and
--          are the usual reason a cost lands twice once the Excel also has it.
-- ---------------------------------------------------------------------------
SELECT co.code AS corp, c.name AS category, re.amount, re.active
FROM public.recurring_expenses re
JOIN public.corporations co ON co.id = re.corporation_id
LEFT JOIN public.expense_categories c ON c.id = re.category_id
ORDER BY co.code, re.amount DESC;
