-- ============================================================================
-- FIX: "Saving payroll failed: there is no unique or exclusion constraint
--       matching the ON CONFLICT specification"
--
-- slack-payroll upserts each expense row with onConflict: 'slack_ts' so that a
-- re-confirmation of the same payroll skips rows already booked instead of
-- double-booking them. Postgres only accepts ON CONFLICT on a column carrying a
-- unique index, and expenses.slack_ts never had one. Every save failed, so
-- Maria's payroll was NOT booked.
--
-- The index must be a PLAIN unique index, not a partial one: Postgres will not
-- match "ON CONFLICT (slack_ts)" against an index that has a WHERE clause
-- (verified on Postgres 16, the partial version reproduces the same error).
--
-- A plain unique index is still safe for the rest of the table, because NULLs
-- never collide in Postgres: every expense with no slack_ts (manual entries,
-- board imports, Toast, recurring) can be inserted freely, as many as needed.
-- Only rows carrying a Slack timestamp get deduplicated, which is the intent.
--
-- Step 1 checks for pre-existing duplicates. If it returns ANY rows, stop and
-- paste the output rather than running Step 2.
-- ============================================================================

-- 1) Any duplicate slack_ts already in the table? Expect ZERO rows.
SELECT slack_ts, count(*) AS copies,
       string_agg(DISTINCT to_char(date,'YYYY-MM-DD'), ', ') AS dates,
       ROUND(sum(amount), 2) AS total_amount
FROM public.expenses
WHERE slack_ts IS NOT NULL
GROUP BY slack_ts
HAVING count(*) > 1
ORDER BY copies DESC;

-- 2) Create the unique index (only if Step 1 returned nothing).
CREATE UNIQUE INDEX IF NOT EXISTS expenses_slack_ts_key
  ON public.expenses (slack_ts);

-- 3) VERIFY: the index exists and has NO partial predicate (indexdef must not
--    contain a WHERE clause, or ON CONFLICT will still fail).
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'expenses' AND indexname = 'expenses_slack_ts_key';
