-- ============================================================================
-- Speed up the Home screen without changing what it shows.
--
-- Home currently pulls every individual revenue row for two windows and sums
-- them in the browser:
--   revMonth : month-to-date rows, only to learn WHICH DAYS have revenue
--   rev14    : last 14 days rows, to build each store's daily sales totals
-- On the measured device these two took ~610ms and ~651ms, the whole bottleneck.
--
-- These functions do the same aggregation on the server and return one row per
-- (store, day) instead of thousands of raw rows. The math matches the app exactly:
--   * only channels with counts_in_total = true contribute
--   * each amount is multiplied by the channel's total_multiplier
-- so computed totals are identical to what the browser produced.
--
-- SECURITY INVOKER: runs as the calling user, so row-level security still applies.
-- ============================================================================

-- Daily counted-in sales total per store over a date range (for the 14-day window).
CREATE OR REPLACE FUNCTION public.home_daily_sales(
  p_corp_ids uuid[],
  p_start date,
  p_end date
) RETURNS TABLE (corporation_id uuid, date date, total numeric)
LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT dr.corporation_id, dr.date,
         ROUND(SUM(dr.amount * COALESCE(rc.total_multiplier, 1)), 2) AS total
  FROM public.daily_revenue dr
  JOIN public.revenue_channels rc ON rc.id = dr.channel_id
  WHERE dr.corporation_id = ANY(p_corp_ids)
    AND dr.date BETWEEN p_start AND p_end
    AND rc.counts_in_total = true
  GROUP BY dr.corporation_id, dr.date
$$;

-- Which days in a range have ANY positive revenue, per store (for the month-to-date
-- "days entered" count). Returns one row per (store, day), no amounts needed.
CREATE OR REPLACE FUNCTION public.home_days_with_revenue(
  p_corp_ids uuid[],
  p_start date,
  p_end date
) RETURNS TABLE (corporation_id uuid, date date)
LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT DISTINCT dr.corporation_id, dr.date
  FROM public.daily_revenue dr
  WHERE dr.corporation_id = ANY(p_corp_ids)
    AND dr.date BETWEEN p_start AND p_end
    AND dr.amount > 0
$$;
