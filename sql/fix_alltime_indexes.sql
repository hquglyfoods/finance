-- ============================================================================
-- FIX: All-Time on BW/FH fails with
--      "canceling statement due to statement timeout"
--
-- All-Time reads a store's ENTIRE history and pages through it. Paging is only
-- correct when the sort is total, so the app orders by id within the store. With
-- no index on (corporation_id, id), Postgres has to fetch and sort every row of
-- the store on each page request, which on the larger stores exceeds Supabase's
-- statement timeout and the query is cancelled.
--
-- These indexes let the paging read rows already in order, so each page is a
-- cheap range scan instead of a full sort.
--
-- Safe to run any time: CREATE INDEX IF NOT EXISTS adds nothing if already there,
-- and indexes never change data.
-- ============================================================================

CREATE INDEX IF NOT EXISTS daily_revenue_corp_id_idx
  ON public.daily_revenue (corporation_id, id);

CREATE INDEX IF NOT EXISTS expenses_corp_id_idx
  ON public.expenses (corporation_id, id);

-- The date-bounded views (Month, Year, Daily, Cash) filter by corporation + date.
-- These make those reads cheap too.
CREATE INDEX IF NOT EXISTS daily_revenue_corp_date_idx
  ON public.daily_revenue (corporation_id, date);

CREATE INDEX IF NOT EXISTS expenses_corp_date_idx
  ON public.expenses (corporation_id, date);

-- VERIFY: all four should be listed.
SELECT indexname
FROM pg_indexes
WHERE tablename IN ('daily_revenue','expenses')
  AND indexname IN ('daily_revenue_corp_id_idx','expenses_corp_id_idx',
                    'daily_revenue_corp_date_idx','expenses_corp_date_idx')
ORDER BY indexname;
