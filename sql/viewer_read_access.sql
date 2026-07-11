-- VIEWER READ ACCESS (read-only)  -- SAFE VERSION
--
-- IMPORTANT: do NOT grant reads on can_view_corp() alone. Investor accounts also carry
-- can_view permissions (they need them for corporations / published reports), so a
-- can_view-only rule would expose raw daily sales and expenses to investors.
--
-- This script therefore gates the new read policies on the role itself: is_viewer().
-- Investors are unaffected and still see only published reports (close_investor_select).
--
-- Safety summary:
--   * READ ONLY. No INSERT/UPDATE/DELETE policy is added or changed, so viewers cannot
--     modify anything. Writes stay gated on is_owner() / can_edit_corp().
--   * Existing policies are untouched. Postgres ORs permissive policies together, so
--     owners and assistants keep working exactly as before.
--   * A viewer only sees corporations where you checked "View" for that account.

-- 1) Helper: is the current user a viewer?  (SECURITY DEFINER so it can read profiles
--    without tripping the profiles RLS, mirroring how is_owner() works.)
CREATE OR REPLACE FUNCTION public.is_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'viewer'
      AND COALESCE(p.active, true)
  );
$$;

REVOKE ALL ON FUNCTION public.is_viewer() FROM public;
GRANT EXECUTE ON FUNCTION public.is_viewer() TO authenticated;

-- 2) Read-only policies for viewers, limited to the corps they were granted View on.

-- Daily sales
DROP POLICY IF EXISTS rev_viewer_select ON public.daily_revenue;
CREATE POLICY rev_viewer_select ON public.daily_revenue
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

-- Expenses (day-by-day detail and P&L)
DROP POLICY IF EXISTS exp_viewer_select ON public.expenses;
CREATE POLICY exp_viewer_select ON public.expenses
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

-- Revenue channels (needed to total sales correctly)
DROP POLICY IF EXISTS chan_viewer_select ON public.revenue_channels;
CREATE POLICY chan_viewer_select ON public.revenue_channels
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

-- Expense categories (names and grouping in Insights)
DROP POLICY IF EXISTS cat_viewer_select ON public.expense_categories;
CREATE POLICY cat_viewer_select ON public.expense_categories
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

-- Rates (royalty / marketing, used by the automatic P&L lines)
DROP POLICY IF EXISTS rate_viewer_select ON public.rate_schedule;
CREATE POLICY rate_viewer_select ON public.rate_schedule
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

-- Automatic expense rules (computed P&L lines, e.g. card fee)
DROP POLICY IF EXISTS rules_viewer_select ON public.auto_expense_rules;
CREATE POLICY rules_viewer_select ON public.auto_expense_rules
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

-- Monthly inputs (rent and other monthly figures used in the P&L).
-- This table only has an ALL policy gated on can_edit_corp, so viewers need a read policy.
DROP POLICY IF EXISTS minputs_viewer_select ON public.monthly_inputs;
CREATE POLICY minputs_viewer_select ON public.monthly_inputs
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

-- 3) VERIFY (optional). Investors must NOT appear here; only viewers.
-- SELECT id, email, role FROM public.profiles WHERE role IN ('viewer','investor') ORDER BY role;
--
-- And confirm no new write policy was created for viewers:
-- SELECT tablename, policyname, cmd, qual FROM pg_policies
-- WHERE schemaname='public' AND policyname LIKE '%viewer%' ORDER BY tablename;
--   (every row should show cmd = SELECT)
