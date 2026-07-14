-- ============================================================================
-- Allow SEVERAL manual income entries on the same channel and day, each with
-- its own note, while the automatic syncs stay strictly one row per day.
--
-- The problem: daily_revenue has UNIQUE (corporation_id, channel_id, date), so
-- two royalty payments received on the same day cannot both be recorded. The
-- second overwrites the first, and its note with it.
--
-- Why not simply drop the constraint: toast-sync and inventory-sync upsert on
-- exactly those three columns. With no unique index behind them, every sync run
-- would INSERT another copy of the day's sales instead of updating the existing
-- row, and revenue would inflate every 10 minutes.
--
-- The fix keeps a unique index for the automatic sources ONLY. Manual rows are
-- outside the index, so a person can add as many as needed; the syncs still see
-- exactly one row per (corp, channel, date) to update.
--
--   automatic (toast, toast_live, inventory, quickbooks, board): 1 row per day
--   manual: as many as you like
--
-- IMPORTANT: run this BEFORE deploying the matching app build. The app's new
-- upsert targets the partial index by name.
-- ============================================================================

-- 1) Are there manual rows that would collide today? (Informational: there can be
--    at most one per key right now, so this returns nothing. Kept as a guard.)
SELECT corporation_id, channel_id, date, count(*) AS rows
FROM public.daily_revenue
WHERE source = 'manual'
GROUP BY corporation_id, channel_id, date
HAVING count(*) > 1;


-- 2) Drop the blanket constraint.
ALTER TABLE public.daily_revenue
  DROP CONSTRAINT IF EXISTS daily_revenue_corporation_id_channel_id_date_key;

-- Some projects created it as an index rather than a constraint.
DROP INDEX IF EXISTS public.daily_revenue_corporation_id_channel_id_date_key;


-- 3) Re-add uniqueness for the AUTOMATIC sources only. The syncs upsert against
--    this index, so they keep updating their single daily row and can never
--    double-count. Manual rows are not covered, so they can repeat freely.
CREATE UNIQUE INDEX IF NOT EXISTS daily_revenue_auto_unique
  ON public.daily_revenue (corporation_id, channel_id, date)
  WHERE source IN ('toast','toast_live','inventory','quickbooks','board');


-- 4) Keep reads fast for the views that filter by corp and date.
CREATE INDEX IF NOT EXISTS daily_revenue_corp_date_idx
  ON public.daily_revenue (corporation_id, date);


-- 5) VERIFY: the partial unique index exists and the blanket one is gone.
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'daily_revenue'
ORDER BY indexname;
