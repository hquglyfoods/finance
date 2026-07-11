-- ============================================================================
-- AD / BW / FH: 21 months are off by exactly one cent against the Excel.
--
-- Cause: the Excel computes derived lines (Sales Tax, Royalty, Other
-- Obligations, Insurance, CC fees) at sub-cent precision and rounds only the
-- TOTAL for display. The board import rounded each line to cents, and in these
-- months the sum of the rounded lines differs from the rounded total by 1 cent.
--
-- Fix: shift one cent on ONE board row per month so the month total lands
-- exactly on the Excel total. The row chosen is the largest board row in a
-- derived category (obligation / tax / royalty / insurance / fee), because
-- those are the lines that actually carry sub-cent values; if a month has no
-- such category, the largest board row absorbs the cent.
--
-- delta = app minus Excel, so amount := amount - delta.
--
-- Run Step 1 (preview, expect 21 rows), then Step 2 (apply, RETURNING shows
-- every change). Verification: rerun reconcile_excel_vs_app.sql; these months
-- must flip to OK.
-- ============================================================================

-- 1) PREVIEW. Expect exactly 21 rows, one per corp-month below.
WITH adj(corp, month, delta) AS (VALUES
  ('AD','2025-02', 0.01),('AD','2025-06', 0.01),('AD','2025-08', 0.01),
  ('AD','2025-09',-0.01),('AD','2025-10',-0.01),('AD','2025-11', 0.01),
  ('AD','2025-12', 0.01),('AD','2026-01', 0.01),('AD','2026-05',-0.01),
  ('AD','2026-06', 0.01),
  ('BW','2025-01', 0.01),('BW','2025-03', 0.01),('BW','2025-06', 0.01),
  ('BW','2025-11',-0.01),('BW','2026-01', 0.01),('BW','2026-04', 0.01),
  ('BW','2026-05',-0.01),
  ('FH','2025-02', 0.01),('FH','2025-06', 0.01),('FH','2025-08', 0.01),
  ('FH','2026-05',-0.01)
)
SELECT DISTINCT ON (a.corp, a.month)
       a.corp, a.month, c.name AS category, e.date,
       e.amount AS current_amount, e.amount - a.delta AS will_become
FROM adj a
JOIN public.corporations co ON co.code = a.corp
JOIN public.expenses e
  ON e.corporation_id = co.id
 AND to_char(e.date,'YYYY-MM') = a.month
 AND e.source = 'board' AND e.status = 'confirmed'
JOIN public.expense_categories c
  ON c.id = e.category_id AND c.corporation_id = co.id
ORDER BY a.corp, a.month,
         (c.name ~* '(obligation|tax|royalty|insurance|fee)') DESC,
         e.amount DESC;


-- 2) APPLY the 21 one-cent shifts.
WITH adj(corp, month, delta) AS (VALUES
  ('AD','2025-02', 0.01),('AD','2025-06', 0.01),('AD','2025-08', 0.01),
  ('AD','2025-09',-0.01),('AD','2025-10',-0.01),('AD','2025-11', 0.01),
  ('AD','2025-12', 0.01),('AD','2026-01', 0.01),('AD','2026-05',-0.01),
  ('AD','2026-06', 0.01),
  ('BW','2025-01', 0.01),('BW','2025-03', 0.01),('BW','2025-06', 0.01),
  ('BW','2025-11',-0.01),('BW','2026-01', 0.01),('BW','2026-04', 0.01),
  ('BW','2026-05',-0.01),
  ('FH','2025-02', 0.01),('FH','2025-06', 0.01),('FH','2025-08', 0.01),
  ('FH','2026-05',-0.01)
),
target AS (
  SELECT DISTINCT ON (a.corp, a.month)
         e.id, a.corp, a.month, a.delta, c.name AS category
  FROM adj a
  JOIN public.corporations co ON co.code = a.corp
  JOIN public.expenses e
    ON e.corporation_id = co.id
   AND to_char(e.date,'YYYY-MM') = a.month
   AND e.source = 'board' AND e.status = 'confirmed'
  JOIN public.expense_categories c
    ON c.id = e.category_id AND c.corporation_id = co.id
  ORDER BY a.corp, a.month,
           (c.name ~* '(obligation|tax|royalty|insurance|fee)') DESC,
           e.amount DESC
)
UPDATE public.expenses e
SET amount = e.amount - t.delta
FROM target t
WHERE e.id = t.id
RETURNING t.corp, t.month, t.category,
          e.amount + t.delta AS old_amount, e.amount AS new_amount, -t.delta AS applied;
