-- ============================================================================
-- REVENUE SNAPSHOTS v2: minute precision.
--
-- The Home comparison now uses "last week as of the CURRENT time", not the
-- current hour. Snapshots therefore carry hour AND minute, and a row is
-- written whenever the day's running total changes (the syncs are change-
-- guarded, so quiet minutes write nothing).
--
-- Old rows are hour-labeled with mixed semantics (live captures = start of
-- hour, Toast backfills = end of hour), so they are cleared for past dates;
-- toast-sync re-backfills last week's same day automatically within the hour,
-- now in the new format.
--
-- Run AFTER deploying the repo that contains the minute-aware sync code.
-- ============================================================================

ALTER TABLE public.revenue_snapshots
  ADD COLUMN IF NOT EXISTS minute smallint NOT NULL DEFAULT 0
  CHECK (minute BETWEEN 0 AND 59);

ALTER TABLE public.revenue_snapshots
  DROP CONSTRAINT IF EXISTS revenue_snapshots_corporation_id_date_hour_key;

-- unique per capture moment
ALTER TABLE public.revenue_snapshots
  DROP CONSTRAINT IF EXISTS revenue_snapshots_corp_date_hour_minute_key;
ALTER TABLE public.revenue_snapshots
  ADD CONSTRAINT revenue_snapshots_corp_date_hour_minute_key
  UNIQUE (corporation_id, date, hour, minute);

-- clear old-format rows; the needed day (last week same weekday, Toast stores)
-- re-backfills automatically in the new format
DELETE FROM public.revenue_snapshots WHERE date < CURRENT_DATE;

-- Verify: minute column exists, new unique in place.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'revenue_snapshots' ORDER BY ordinal_position;
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.revenue_snapshots'::regclass AND contype = 'u';
