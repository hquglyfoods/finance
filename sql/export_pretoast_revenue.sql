-- ============================================================================
-- Export pre-Toast daily revenue for the Ugly Marketing app.
--
-- Output: one row per (store, day) with the day's RECOGNIZED sales total, using
-- the exact rules computePL uses in the Finance app, so each value matches the
-- store's Home "today" figure and the P&L "Sales":
--
--   1. Only channels with counts_in_total = true contribute.
--   2. Each amount is multiplied by that channel's total_multiplier
--      (SUM(amount * total_multiplier), not a plain SUM).
--   3. Per-date board precedence: on any (store, date) that has a board (Excel)
--      row, ONLY board rows count and live rows (toast/inventory/etc.) for that
--      date are ignored. Dates with no board row use their non-board rows.
--      Almost all pre-Toast history is board data, so this matters here.
--   4. Stores AD, BW, FH only (HQ, UMMA, Pearland excluded).
--   5. Dates up to 2025-06-30 (Toast era, 2025-07-01 on, is excluded; the
--      Marketing app already has that from Toast).
--
-- Columns: store, date, revenue  (headers exactly, for the Marketing import).
--
-- HOW TO RUN:
--   A) Run STEP 0 first (schema check). If your column names differ from the
--      assumptions noted there, tell me and I'll adjust; otherwise continue.
--   B) Run STEP 1 (preview, 20 rows) and eyeball the values.
--   C) Run STEP 2 (full export) and download the result as CSV.
-- ============================================================================


-- ---------- STEP 0: schema check (read-only) ----------
-- Confirms the tables/columns this export assumes actually exist. Expected:
--   daily_revenue(corporation_id, channel_id, date, amount, source)
--   revenue_channels(id, corporation_id, counts_in_total, total_multiplier)
--   corporations(id, code)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ( (table_name='daily_revenue'    AND column_name IN ('corporation_id','channel_id','date','amount','source'))
     OR (table_name='revenue_channels' AND column_name IN ('id','corporation_id','counts_in_total','total_multiplier'))
     OR (table_name='corporations'     AND column_name IN ('id','code')) )
ORDER BY table_name, column_name;


-- ---------- STEP 1: PREVIEW (first 20 rows) ----------
WITH scope AS (
  SELECT dr.corporation_id, dr.channel_id, dr.date, dr.amount, dr.source,
         co.code AS store,
         rc.counts_in_total, rc.total_multiplier
  FROM public.daily_revenue dr
  JOIN public.corporations     co ON co.id = dr.corporation_id
  JOIN public.revenue_channels rc ON rc.id = dr.channel_id
  WHERE co.code IN ('AD','BW','FH')
    AND dr.date <= DATE '2025-06-30'
),
-- which (store, date) have a board row: those dates are board-only
board_dates AS (
  SELECT DISTINCT store, date FROM scope WHERE source = 'board'
),
-- keep the rows computePL would count: board rows on board dates, non-board rows elsewhere
counted AS (
  SELECT s.store, s.date, s.amount, s.counts_in_total, s.total_multiplier
  FROM scope s
  LEFT JOIN board_dates b ON b.store = s.store AND b.date = s.date
  WHERE s.counts_in_total = true
    AND (
      (b.store IS NOT NULL AND s.source = 'board')      -- board date -> board rows only
      OR
      (b.store IS NULL AND s.source <> 'board')          -- non-board date -> non-board rows
    )
)
SELECT store,
       to_char(date, 'YYYY-MM-DD') AS date,
       ROUND(SUM(amount * total_multiplier), 2) AS revenue
FROM counted
GROUP BY store, date
HAVING ROUND(SUM(amount * total_multiplier), 2) <> 0
ORDER BY store, date
LIMIT 20;


-- ---------- STEP 2: FULL EXPORT (download as CSV) ----------
-- Identical to STEP 1 without the LIMIT. Download the result grid as CSV; the
-- header row will read: store,date,revenue
WITH scope AS (
  SELECT dr.corporation_id, dr.channel_id, dr.date, dr.amount, dr.source,
         co.code AS store,
         rc.counts_in_total, rc.total_multiplier
  FROM public.daily_revenue dr
  JOIN public.corporations     co ON co.id = dr.corporation_id
  JOIN public.revenue_channels rc ON rc.id = dr.channel_id
  WHERE co.code IN ('AD','BW','FH')
    AND dr.date <= DATE '2025-06-30'
),
board_dates AS (
  SELECT DISTINCT store, date FROM scope WHERE source = 'board'
),
counted AS (
  SELECT s.store, s.date, s.amount, s.counts_in_total, s.total_multiplier
  FROM scope s
  LEFT JOIN board_dates b ON b.store = s.store AND b.date = s.date
  WHERE s.counts_in_total = true
    AND (
      (b.store IS NOT NULL AND s.source = 'board')
      OR
      (b.store IS NULL AND s.source <> 'board')
    )
)
SELECT store,
       to_char(date, 'YYYY-MM-DD') AS date,
       ROUND(SUM(amount * total_multiplier), 2) AS revenue
FROM counted
GROUP BY store, date
HAVING ROUND(SUM(amount * total_multiplier), 2) <> 0
ORDER BY store, date;
