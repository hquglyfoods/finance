-- ============================================================================
-- REVENUE SNAPSHOTS: intraday cumulative sales, one row per (corp, date, hour).
--
-- Purpose: the Home cards compare today's running sales against last week.
-- Comparing a half-finished morning against last week's FULL day always looks
-- like a crash, so the app needs "how much had this store sold by this hour
-- last week". The hourly syncs (toast-sync for AD/BW/FH, inventory-sync for
-- HQ/UMMA) capture today's running total each run; toast-sync also backfills
-- last week's hours once from Toast order timestamps, so Toast stores compare
-- correctly immediately after deploy.
--
-- Writes: service key only (the Netlify functions). No write policy exists
-- for app users on purpose.
-- Reads: owners/assistants for their corps, viewers for corps granted View.
-- Investors get nothing (same principle as daily_revenue: raw sales are not
-- investor data; they see published reports only).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.revenue_snapshots (
  corporation_id uuid NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  date           date NOT NULL,
  hour           smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  amount         numeric NOT NULL DEFAULT 0,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporation_id, date, hour)
);

CREATE INDEX IF NOT EXISTS revenue_snapshots_corp_date
  ON public.revenue_snapshots (corporation_id, date);

ALTER TABLE public.revenue_snapshots ENABLE ROW LEVEL SECURITY;

-- Owners and assistants: read snapshots for corps they can edit.
DROP POLICY IF EXISTS snap_edit_select ON public.revenue_snapshots;
CREATE POLICY snap_edit_select ON public.revenue_snapshots
  FOR SELECT TO authenticated
  USING (is_owner() OR can_edit_corp(corporation_id));

-- Viewers: read-only, only corps granted View. Gated on is_viewer() AND
-- can_view_corp() (NEVER can_view alone, or investors would see raw sales).
DROP POLICY IF EXISTS snap_viewer_select ON public.revenue_snapshots;
CREATE POLICY snap_viewer_select ON public.revenue_snapshots
  FOR SELECT TO authenticated
  USING (is_viewer() AND can_view_corp(corporation_id));

GRANT SELECT ON public.revenue_snapshots TO authenticated;

-- Verify: table exists, RLS on, 2 policies.
SELECT relrowsecurity AS rls_enabled FROM pg_class WHERE relname = 'revenue_snapshots';
SELECT polname FROM pg_policy WHERE polrelid = 'public.revenue_snapshots'::regclass ORDER BY polname;
