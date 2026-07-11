-- ============================================================================
-- HQ 2026-02 DIAGNOSTIC. Run and paste every result block.
--
-- Background: the Excel closing board's February column had formulas pointing
-- at the '2026-03' tab, so February displayed March numbers, and the board
-- import copied those March numbers into the DB as February. The DB February
-- currently mirrors March exactly (sales 50,963.63 / expenses 76,996.89).
--
-- True February (rebuilt from the 2026-02 tab and the board's own formulas):
--   sales    51,038.25  (Ingredients 38,921.00 + Royalty 6,001.11 + Others 6,116.14)
--   expenses 49,761.85  (Lease 6,006 + Utilities 100 + Mortgage 7,846 + Payroll 10,000
--                        + Supplies Food 19,294.08 + Others 5,035.74
--                        + Other Obligations 1,480.03)
--
-- These dumps show exactly how February and March board rows are structured
-- (dates, channels, categories) so the repair SQL can rebuild February
-- precisely, matching the import's own conventions. Nothing here modifies data.
-- ============================================================================

-- A) HQ February + March board EXPENSE rows
SELECT to_char(e.date,'YYYY-MM') AS month, e.date, c.code AS cat_code,
       c.name AS category, e.amount, e.source, e.id
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id AND co.code = 'HQ'
LEFT JOIN public.expense_categories c
  ON c.id = e.category_id AND c.corporation_id = e.corporation_id
WHERE e.source = 'board' AND e.status = 'confirmed'
  AND e.date >= '2026-02-01' AND e.date < '2026-04-01'
ORDER BY e.date, c.name;

-- B) HQ February + March board REVENUE rows
SELECT to_char(r.date,'YYYY-MM') AS month, r.date, ch.code AS channel_code,
       ch.name AS channel, r.amount, r.source, r.id
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'HQ'
LEFT JOIN public.revenue_channels ch
  ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE r.source = 'board'
  AND r.date >= '2026-02-01' AND r.date < '2026-04-01'
ORDER BY r.date, ch.name;

-- C) Any NON-board rows sitting in HQ February (they survive the repair,
--    so they must be known before rebuilding).
SELECT 'expense' AS kind, e.date, c.name AS label, e.amount, e.source, e.status
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id AND co.code = 'HQ'
LEFT JOIN public.expense_categories c ON c.id = e.category_id
WHERE e.source <> 'board'
  AND e.date >= '2026-02-01' AND e.date < '2026-03-01'
UNION ALL
SELECT 'revenue', r.date, ch.name, r.amount, r.source, ''
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'HQ'
LEFT JOIN public.revenue_channels ch ON ch.id = r.channel_id
WHERE r.source <> 'board'
  AND r.date >= '2026-02-01' AND r.date < '2026-03-01'
ORDER BY 1, 2;
