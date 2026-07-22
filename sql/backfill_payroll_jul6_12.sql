-- ============================================================================
-- Backfill the Jul 6-12, 2026 payroll that failed to save in Slack (the
-- ON CONFLICT error happened before the slack_ts index existed, so nothing was
-- booked). Numbers are taken from the ADP "Preview payroll" screenshots:
--
--   Store  Gross pay (payroll)   Employer taxes (payroll_tax)
--   AD     6210.88               682.58
--   BW     5778.30               514.09
--   FH     4025.16               350.99
--
-- Rows are written exactly like slack-payroll writes them: categories
-- 'payroll' and 'payroll_tax', source 'payroll_bot', status 'confirmed', dated
-- the week-ending Sunday 2026-07-12. The slack_ts keys use a 'manual_backfill'
-- prefix so they never collide with a real Slack ('pr_...') or HR ('hr_...')
-- submission, and the unique index still prevents this backfill from being run
-- twice.
--
-- STEP 1 previews what will be inserted. STEP 2 inserts. Run STEP 1 first.
-- ============================================================================

-- ---------- STEP 1: preview (read-only) ----------
-- Confirms each store + category resolves to a real id, and shows the amounts.
WITH want(store, cat, amount, tag) AS (
  VALUES
    ('AD','payroll',      6210.88::numeric, 'manual_backfill_2026-07-12_AD_p'),
    ('AD','payroll_tax',   682.58::numeric, 'manual_backfill_2026-07-12_AD_t'),
    ('BW','payroll',      5778.30::numeric, 'manual_backfill_2026-07-12_BW_p'),
    ('BW','payroll_tax',   514.09::numeric, 'manual_backfill_2026-07-12_BW_t'),
    ('FH','payroll',      4025.16::numeric, 'manual_backfill_2026-07-12_FH_p'),
    ('FH','payroll_tax',   350.99::numeric, 'manual_backfill_2026-07-12_FH_t')
)
SELECT w.store, w.cat, w.amount, co.id AS corp_id, ec.id AS category_id, w.tag AS slack_ts,
       DATE '2026-07-12' AS date
FROM want w
JOIN public.corporations co ON co.code = w.store
JOIN public.expense_categories ec ON ec.corporation_id = co.id AND ec.code = w.cat
ORDER BY w.store, w.cat;
-- Expect 6 rows. If any store/category is missing (fewer than 6 rows), stop and tell me.


-- ---------- STEP 2: insert ----------
-- ON CONFLICT (slack_ts) DO NOTHING makes this safe to run more than once.
INSERT INTO public.expenses (corporation_id, category_id, date, amount, memo, source, status, slack_ts)
SELECT co.id, ec.id, DATE '2026-07-12', w.amount,
       (CASE WHEN w.cat='payroll' THEN 'Payroll (ADP, backfill) wk ending 2026-07-12'
             ELSE 'Payroll tax (ADP, backfill) wk ending 2026-07-12' END),
       'payroll_bot', 'confirmed', w.tag
FROM (VALUES
    ('AD','payroll',      6210.88::numeric, 'manual_backfill_2026-07-12_AD_p'),
    ('AD','payroll_tax',   682.58::numeric, 'manual_backfill_2026-07-12_AD_t'),
    ('BW','payroll',      5778.30::numeric, 'manual_backfill_2026-07-12_BW_p'),
    ('BW','payroll_tax',   514.09::numeric, 'manual_backfill_2026-07-12_BW_t'),
    ('FH','payroll',      4025.16::numeric, 'manual_backfill_2026-07-12_FH_p'),
    ('FH','payroll_tax',   350.99::numeric, 'manual_backfill_2026-07-12_FH_t')
  ) AS w(store, cat, amount, tag)
JOIN public.corporations co ON co.code = w.store
JOIN public.expense_categories ec ON ec.corporation_id = co.id AND ec.code = w.cat
ON CONFLICT (slack_ts) DO NOTHING;


-- ---------- STEP 3: verify ----------
SELECT co.code AS store, ec.code AS category, e.date, e.amount, e.source, e.status
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE e.slack_ts LIKE 'manual_backfill_2026-07-12_%'
ORDER BY co.code, ec.code;
-- Expect 6 rows: AD/BW/FH each with payroll and payroll_tax.
