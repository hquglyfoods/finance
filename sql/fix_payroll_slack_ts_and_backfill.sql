-- ============================================================================
-- Payroll save is still failing in Slack:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Cause: slack-payroll upserts expense rows with ON CONFLICT (slack_ts), but the
-- expenses table has no unique index on slack_ts, so every payroll save fails and
-- nothing is booked (Maria's Jul 6-12 payroll is missing in Finance).
--
-- This script (A) checks for the index, (B) checks for duplicates that would block
-- creating it, (C) creates it, then (D) shows how to backfill the missing week.
-- Run the STEPs in order and read each result.
-- ============================================================================

-- ---------- STEP A: does the unique index already exist? ----------
-- If this returns a row whose indexdef has NO "WHERE", the index is fine and the
-- error is something else (paste the result). If it returns nothing, go to STEP B.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='expenses'
  AND indexdef ILIKE '%slack_ts%';


-- ---------- STEP B: any duplicate slack_ts blocking the index? ----------
-- Must return ZERO rows before creating a unique index. If it returns rows, stop
-- and paste them; we will de-dupe first.
SELECT slack_ts, count(*) AS copies,
       string_agg(DISTINCT to_char(date,'YYYY-MM-DD'), ', ') AS dates,
       ROUND(sum(amount),2) AS total_amount
FROM public.expenses
WHERE slack_ts IS NOT NULL
GROUP BY slack_ts
HAVING count(*) > 1
ORDER BY copies DESC;


-- ---------- STEP C: create the plain unique index ----------
-- Plain (no WHERE): Postgres will not match ON CONFLICT (slack_ts) against a
-- partial index. NULLs never collide, so non-Slack rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_slack_ts_key
  ON public.expenses (slack_ts);

-- verify it exists and is not partial
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='expenses' AND indexname='expenses_slack_ts_key';


-- ---------- STEP D: is the Jul 6-12 AD payroll actually missing? ----------
-- Check what payroll rows exist for AD around that week. The Slack summary showed
-- AD Jul 6-12: Gross pay 6,210.88, Employer taxes 970.59 (from the screenshot).
SELECT co.code AS store, ec.code AS category, dr.date, dr.amount, dr.source, dr.status, dr.slack_ts
FROM public.expenses dr
JOIN public.corporations co ON co.id = dr.corporation_id
JOIN public.expense_categories ec ON ec.id = dr.category_id
WHERE co.code='AD'
  AND ec.code IN ('payroll','payroll_tax')
  AND dr.date BETWEEN '2026-07-06' AND '2026-07-14'
ORDER BY dr.date, ec.code;
