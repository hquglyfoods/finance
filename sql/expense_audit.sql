-- ============================================================================
-- EXPENSE RECONCILIATION AUDIT  (why does the app's expense total differ from Excel?)
--
-- HOW THE APP COMPUTES EXPENSES (so you know what to compare against):
--   * Only rows with status = 'confirmed' count. pending / rejected are EXCLUDED.
--   * "Board lock": if a PAST month (before the current calendar month) has any row with
--     source='board' (the Excel import), then for that month the app counts ONLY board rows
--     and IGNORES the auto-captured sources (slack / toast / inventory).
--     BUT payroll, recurring, manual and Card Tips always still count, even in a locked month.
--   * In a board-locked month, the AUTO RULES (royalty, marketing, sales tax, cc fee,
--     delivery commission, etc.) are NOT applied at all. The Excel is trusted as final.
--   * A row whose category was deleted is silently dropped from the total.
--
-- Run each block for FH and share the output.
-- Replace the month if you want a different one. FH = the corporation code.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Set the target. Change these two lines only.
--    (Using a CTE so you can paste each query independently.)
-- ---------------------------------------------------------------------------
-- corp code = 'FH', month = last month

-- ---------------------------------------------------------------------------
-- 1) HEADLINE: what does the app total to for FH last month, by source?
--    This shows exactly which rows are being counted and which are being skipped.
-- ---------------------------------------------------------------------------
WITH t AS (
  SELECT e.*, c.code AS cat_code, c.name AS cat_name
  FROM public.expenses e
  JOIN public.corporations co ON co.id = e.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = e.category_id
  WHERE co.code = 'FH'
    AND e.date >= date_trunc('month', CURRENT_DATE - interval '1 month')::date
    AND e.date <  date_trunc('month', CURRENT_DATE)::date
),
board AS (SELECT EXISTS (SELECT 1 FROM t WHERE source='board' AND status='confirmed') AS has_board)
SELECT
  t.source,
  t.status,
  count(*)      AS rows,
  sum(t.amount) AS total,
  CASE
    WHEN t.status <> 'confirmed' THEN 'EXCLUDED (not confirmed)'
    WHEN (SELECT has_board FROM board)
         AND t.source IN ('slack','toast','inventory')
         AND COALESCE(t.cat_code,'') <> 'tips'
      THEN 'EXCLUDED (board lock supersedes auto source)'
    WHEN t.category_id IS NULL OR t.cat_code IS NULL
      THEN 'EXCLUDED (orphan: category missing)'
    ELSE 'COUNTED'
  END AS app_treatment
FROM t
GROUP BY t.source, t.status, app_treatment
ORDER BY app_treatment, total DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- 2) THE NUMBER: the app's expense total for FH last month (categories only,
--    before auto-rules). Compare THIS to your Excel expense total.
-- ---------------------------------------------------------------------------
WITH t AS (
  SELECT e.*, c.code AS cat_code
  FROM public.expenses e
  JOIN public.corporations co ON co.id = e.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = e.category_id
  WHERE co.code = 'FH'
    AND e.date >= date_trunc('month', CURRENT_DATE - interval '1 month')::date
    AND e.date <  date_trunc('month', CURRENT_DATE)::date
    AND e.status = 'confirmed'
),
board AS (SELECT EXISTS (SELECT 1 FROM t WHERE source='board') AS has_board)
SELECT
  (SELECT has_board FROM board)                         AS month_is_board_locked,
  count(*)                                              AS counted_rows,
  sum(amount)                                           AS app_expense_total
FROM t
WHERE cat_code IS NOT NULL
  AND NOT (
    (SELECT has_board FROM board)
    AND source IN ('slack','toast','inventory')
    AND COALESCE(cat_code,'') <> 'tips'
  );

-- ---------------------------------------------------------------------------
-- 3) BREAKDOWN BY CATEGORY (this is the list to line up against Excel line by line)
-- ---------------------------------------------------------------------------
WITH t AS (
  SELECT e.*, c.code AS cat_code, c.name AS cat_name
  FROM public.expenses e
  JOIN public.corporations co ON co.id = e.corporation_id
  LEFT JOIN public.expense_categories c ON c.id = e.category_id
  WHERE co.code = 'FH'
    AND e.date >= date_trunc('month', CURRENT_DATE - interval '1 month')::date
    AND e.date <  date_trunc('month', CURRENT_DATE)::date
    AND e.status = 'confirmed'
),
board AS (SELECT EXISTS (SELECT 1 FROM t WHERE source='board') AS has_board)
SELECT
  COALESCE(t.cat_name, '(orphan / no category)') AS category,
  sum(t.amount) FILTER (WHERE NOT (
      (SELECT has_board FROM board) AND t.source IN ('slack','toast','inventory')
      AND COALESCE(t.cat_code,'') <> 'tips'
  ) AND t.cat_code IS NOT NULL) AS counted_by_app,
  sum(t.amount) AS all_rows_regardless,
  string_agg(DISTINCT t.source, ', ') AS sources
FROM t
GROUP BY category
ORDER BY counted_by_app DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- 4) ALL MONTHS, ALL CORPS: where else could Excel and the app disagree?
--    Any month with BOTH board rows AND auto-source rows is a month where the app
--    is suppressing the auto rows. If Excel was built from the auto rows, they differ.
-- ---------------------------------------------------------------------------
SELECT
  co.code                                   AS corp,
  to_char(e.date, 'YYYY-MM')                AS month,
  sum(e.amount) FILTER (WHERE e.source='board')                          AS board_total,
  sum(e.amount) FILTER (WHERE e.source IN ('slack','toast','inventory')) AS auto_total_suppressed,
  sum(e.amount) FILTER (WHERE e.source NOT IN ('board','slack','toast','inventory')) AS always_counted,
  count(*)      FILTER (WHERE e.source='board')                          AS board_rows,
  count(*)      FILTER (WHERE e.source IN ('slack','toast','inventory')) AS auto_rows
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
WHERE e.status='confirmed'
GROUP BY corp, month
HAVING count(*) FILTER (WHERE e.source='board') > 0
   AND count(*) FILTER (WHERE e.source IN ('slack','toast','inventory')) > 0
ORDER BY month DESC, corp;

-- ---------------------------------------------------------------------------
-- 5) NON-CONFIRMED rows sitting in past months (these are invisible to the app,
--    and are a common reason the app total is LOWER than Excel).
-- ---------------------------------------------------------------------------
SELECT
  co.code AS corp,
  to_char(e.date,'YYYY-MM') AS month,
  e.status,
  count(*) AS rows,
  sum(e.amount) AS total_not_counted
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
WHERE e.status <> 'confirmed'
GROUP BY corp, month, e.status
ORDER BY month DESC, total_not_counted DESC;

-- ---------------------------------------------------------------------------
-- 6) POSSIBLE DOUBLE-COUNTING: same corp + category + date appearing more than once
--    from DIFFERENT sources in a month the app does NOT board-lock (current month),
--    or duplicated recurring rows.
-- ---------------------------------------------------------------------------
SELECT
  co.code AS corp, e.date, c.name AS category,
  count(*) AS rows, sum(e.amount) AS total,
  string_agg(e.source || ':' || e.amount::text, ' | ' ORDER BY e.source) AS detail
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
LEFT JOIN public.expense_categories c ON c.id = e.category_id
WHERE e.status='confirmed'
GROUP BY co.code, e.date, c.name
HAVING count(*) > 1
ORDER BY e.date DESC
LIMIT 60;
