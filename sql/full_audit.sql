-- FULL AUDIT: run each block and share the output.
-- These check the things a code review cannot see (DB defaults, constraints, real data).

-- ============================================================
-- A) CRITICAL: what status do recurring expenses get?
--    recurring-cron.js inserts expenses WITHOUT setting status, so it relies on the
--    column default. Every other writer (toast-sync, slack, app) sets status explicitly.
--    If the default is not 'confirmed', recurring bills (rent, loans, owner pay) are
--    silently EXCLUDED from the P&L, because computePL only counts confirmed rows.
-- ============================================================
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='expenses' AND column_name='status';

-- A2) Reality check: are any recurring rows sitting in a non-confirmed status?
SELECT status, count(*) AS rows, sum(amount) AS total_amount
FROM public.expenses
WHERE source = 'recurring'
GROUP BY status
ORDER BY rows DESC;

-- ============================================================
-- B) Duplicate protection for recurring expenses.
--    recurring-cron checks "does a row already exist" then inserts. If the cron ever
--    runs twice concurrently, that check can race and create duplicates, unless the DB
--    has a unique constraint. Check for duplicates that already exist:
-- ============================================================
SELECT recurring_id, date, count(*) AS copies, sum(amount) AS total
FROM public.expenses
WHERE recurring_id IS NOT NULL
GROUP BY recurring_id, date
HAVING count(*) > 1
ORDER BY copies DESC, date DESC
LIMIT 50;

-- B2) Is there a unique index protecting it?
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='expenses';

-- ============================================================
-- C) Duplicate revenue rows (toast-sync upserts on corp+channel+date, so the unique
--    index must actually exist or the upsert silently becomes an insert).
-- ============================================================
SELECT corporation_id, channel_id, date, count(*) AS copies
FROM public.daily_revenue
GROUP BY corporation_id, channel_id, date
HAVING count(*) > 1
ORDER BY copies DESC
LIMIT 50;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='daily_revenue';

-- ============================================================
-- D) Orphans / broken references that would quietly drop money from the P&L.
--    computePL SKIPS any expense whose category_id is not in the category list, and any
--    revenue row whose channel_id is unknown. Those amounts vanish from totals silently.
-- ============================================================
-- D1) Expenses pointing at a missing category
SELECT count(*) AS orphan_expenses, COALESCE(sum(amount),0) AS amount_lost
FROM public.expenses e
LEFT JOIN public.expense_categories c ON c.id = e.category_id
WHERE e.status='confirmed' AND (e.category_id IS NULL OR c.id IS NULL);

-- D2) Revenue pointing at a missing channel
SELECT count(*) AS orphan_revenue, COALESCE(sum(amount),0) AS amount_lost
FROM public.daily_revenue r
LEFT JOIN public.revenue_channels ch ON ch.id = r.channel_id
WHERE r.channel_id IS NULL OR ch.id IS NULL;

-- ============================================================
-- E) Auto-rule sanity: any rule whose expression references a variable that does not
--    exist will evaluate oddly. List active rules so the expressions can be eyeballed.
-- ============================================================
SELECT c.code AS corp, r.code, r.name, r.expr, r.active
FROM public.auto_expense_rules r
JOIN public.corporations c ON c.id = r.corporation_id
ORDER BY c.code, r.display_order, r.code;

-- ============================================================
-- F) Cash ledger integrity (owner-only feature added recently)
-- ============================================================
-- F1) transfers must come in balanced pairs (one out, one in per transfer_group)
SELECT transfer_group, count(*) AS rows,
       count(*) FILTER (WHERE direction='out') AS outs,
       count(*) FILTER (WHERE direction='in')  AS ins,
       sum(CASE WHEN direction='out' THEN amount ELSE -amount END) AS should_be_zero
FROM public.cash_ledger
WHERE transfer_group IS NOT NULL
GROUP BY transfer_group
HAVING count(*) <> 2
    OR count(*) FILTER (WHERE direction='out') <> 1
    OR count(*) FILTER (WHERE direction='in')  <> 1
    OR sum(CASE WHEN direction='out' THEN amount ELSE -amount END) <> 0;

-- F2) cash-out rows that claim a linked P&L expense but the expense is gone
SELECT cl.id, cl.date, cl.amount, cl.expense_id
FROM public.cash_ledger cl
LEFT JOIN public.expenses e ON e.id = cl.expense_id
WHERE cl.expense_id IS NOT NULL AND e.id IS NULL;

-- ============================================================
-- G) Security re-check: no viewer write policies, and viewers cannot reach cash tables.
-- ============================================================
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname='public' AND policyname LIKE '%viewer%'
ORDER BY tablename;   -- every row must be cmd = SELECT

-- G2) Confirm the cash tables have NO viewer-readable policy (viewers should not see cash)
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('cash_ledger','cash_pickups','cash_out_types')
ORDER BY tablename, policyname;
