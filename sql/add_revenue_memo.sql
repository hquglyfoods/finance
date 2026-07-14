-- ============================================================================
-- Add a note to revenue entries.
--
-- Expenses have always carried a memo, revenue never did, so a one-off income
-- (for example the Texas 3% royalty) landed as a bare number with nothing to
-- say what it was. This adds the same free-text note to revenue.
--
-- Nullable, so every existing row stays valid and nothing is rewritten. The
-- automatic sources (Toast, inventory) simply leave it empty.
-- ============================================================================

ALTER TABLE public.daily_revenue
  ADD COLUMN IF NOT EXISTS memo text;

-- VERIFY: the column should be listed.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'daily_revenue' AND column_name = 'memo';
