-- ============================================================================
-- FIX (root cause): All-Time times out on the larger stores.
--
-- All-Time was pulling EVERY daily revenue and expense row of a store into the
-- browser (years of per-day data, paged 500 at a time) and summing them there.
-- On BW and FH that is enough work for Postgres to hit Supabase's statement
-- timeout, and no amount of waiting in the app can fix that: the server has
-- already cancelled the query.
--
-- The app never needed the individual rows. All-Time only shows monthly and
-- yearly totals, so the summing belongs in the database. These two functions
-- return ONE ROW PER MONTH (a few dozen rows for a store's entire history)
-- instead of tens of thousands of daily rows.
--
-- The aggregation replicates the app's own rules exactly, the same ones proven
-- equal to computePL in tools/test_sql_parity.js:
--   * revenue counts only channels with counts_in_total, times total_multiplier
--   * a past month with board rows on a side is Excel-locked on THAT side
--   * on a locked expense side: board counts; slack/toast/inventory/recurring
--     are dropped; payroll_bot is dropped only when the Excel carries payroll
--   * on a locked revenue side: only board rows count
--   * rows whose category/channel is missing are dropped
--
-- SECURITY: both functions run with the CALLER's permissions (INVOKER), so a
-- user only ever sees corps their RLS policies already allow. No privilege is
-- granted here that the user did not already have.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Monthly REVENUE totals for one corporation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.monthly_revenue_totals(p_corp uuid)
RETURNS TABLE (month text, total numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH rv AS (
    SELECT to_char(r.date,'YYYY-MM') AS ym,
           r.source,
           r.amount,
           ch.id              AS ch_id,
           ch.counts_in_total,
           ch.total_multiplier
    FROM public.daily_revenue r
    LEFT JOIN public.revenue_channels ch
           ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
    WHERE r.corporation_id = p_corp
  ),
  flags AS (
    SELECT ym, bool_or(source = 'board') AS rev_locked
    FROM rv GROUP BY ym
  )
  SELECT rv.ym,
         COALESCE(sum(rv.amount * COALESCE(rv.total_multiplier,1)) FILTER (
           WHERE rv.ch_id IS NOT NULL
             AND rv.counts_in_total
             AND NOT (f.rev_locked AND rv.source <> 'board')
         ), 0)
  FROM rv JOIN flags f USING (ym)
  GROUP BY rv.ym
  ORDER BY rv.ym;
$$;

-- ---------------------------------------------------------------------------
-- Monthly EXPENSE totals for one corporation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.monthly_expense_totals(p_corp uuid)
RETURNS TABLE (month text, total numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ex AS (
    SELECT to_char(e.date,'YYYY-MM') AS ym,
           e.source,
           e.amount,
           c.code AS cat_code
    FROM public.expenses e
    LEFT JOIN public.expense_categories c
           ON c.id = e.category_id AND c.corporation_id = e.corporation_id
    WHERE e.corporation_id = p_corp
      AND e.status = 'confirmed'
  ),
  flags AS (
    SELECT ym,
           bool_or(source = 'board') AS exp_locked,
           bool_or(source = 'board' AND cat_code IN ('payroll','payroll_tax')) AS excel_has_payroll
    FROM ex GROUP BY ym
  )
  SELECT ex.ym,
         COALESCE(sum(ex.amount) FILTER (
           WHERE ex.cat_code IS NOT NULL
             AND NOT (
               f.exp_locked AND ex.source <> 'board' AND (
                 ex.source IN ('slack','toast','inventory','recurring')
                 OR (ex.source = 'payroll_bot' AND f.excel_has_payroll)
               )
             )
         ), 0)
  FROM ex JOIN flags f USING (ym)
  GROUP BY ex.ym
  ORDER BY ex.ym;
$$;

GRANT EXECUTE ON FUNCTION public.monthly_revenue_totals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.monthly_expense_totals(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY. Replace the uuid with BW's id (Settings shows it, or use the query
-- below). Each call should return one row per month, fast.
-- ---------------------------------------------------------------------------
-- SELECT id, code FROM public.corporations ORDER BY code;
-- SELECT * FROM public.monthly_revenue_totals('<BW-uuid>');
-- SELECT * FROM public.monthly_expense_totals('<BW-uuid>');

SELECT proname FROM pg_proc
WHERE proname IN ('monthly_revenue_totals','monthly_expense_totals')
ORDER BY proname;


-- ============================================================================
-- BREAKDOWN totals for the whole history of one corporation, so the All-Time
-- "Where the Money Went / Came From" cards keep working without pulling the
-- daily rows. Same rules again; one row per category / per channel.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.alltime_expense_by_category(p_corp uuid)
RETURNS TABLE (name text, total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH ex AS (
    SELECT to_char(e.date,'YYYY-MM') AS ym, e.source, e.amount,
           c.code AS cat_code, c.name AS cat_name
    FROM public.expenses e
    LEFT JOIN public.expense_categories c
           ON c.id = e.category_id AND c.corporation_id = e.corporation_id
    WHERE e.corporation_id = p_corp AND e.status = 'confirmed'
  ),
  flags AS (
    SELECT ym,
           bool_or(source = 'board') AS exp_locked,
           bool_or(source = 'board' AND cat_code IN ('payroll','payroll_tax')) AS excel_has_payroll
    FROM ex GROUP BY ym
  )
  SELECT ex.cat_name, sum(ex.amount)
  FROM ex JOIN flags f USING (ym)
  WHERE ex.cat_code IS NOT NULL
    AND NOT (
      f.exp_locked AND ex.source <> 'board' AND (
        ex.source IN ('slack','toast','inventory','recurring')
        OR (ex.source = 'payroll_bot' AND f.excel_has_payroll)
      )
    )
  GROUP BY ex.cat_name
  HAVING sum(ex.amount) <> 0
  ORDER BY 2 DESC;
$$;

CREATE OR REPLACE FUNCTION public.alltime_revenue_by_channel(p_corp uuid)
RETURNS TABLE (name text, total numeric, counts_in_total boolean, total_multiplier numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH rv AS (
    SELECT to_char(r.date,'YYYY-MM') AS ym, r.source, r.amount,
           ch.id AS ch_id, ch.name AS ch_name,
           ch.counts_in_total, ch.total_multiplier
    FROM public.daily_revenue r
    LEFT JOIN public.revenue_channels ch
           ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
    WHERE r.corporation_id = p_corp
  ),
  flags AS (SELECT ym, bool_or(source='board') AS rev_locked FROM rv GROUP BY ym)
  SELECT rv.ch_name,
         sum(rv.amount * COALESCE(rv.total_multiplier,1)),
         bool_or(rv.counts_in_total),
         max(COALESCE(rv.total_multiplier,1))
  FROM rv JOIN flags f USING (ym)
  WHERE rv.ch_id IS NOT NULL
    AND NOT (f.rev_locked AND rv.source <> 'board')
  GROUP BY rv.ch_name
  HAVING sum(rv.amount * COALESCE(rv.total_multiplier,1)) <> 0
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.alltime_expense_by_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.alltime_revenue_by_channel(uuid) TO authenticated;

SELECT proname FROM pg_proc
WHERE proname IN ('monthly_revenue_totals','monthly_expense_totals',
                  'alltime_expense_by_category','alltime_revenue_by_channel')
ORDER BY proname;
