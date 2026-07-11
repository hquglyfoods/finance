-- ============================================================================
-- UMMA REVENUE AUDIT
--
-- Symptom: revenue from the Excel does not show up, and the app's UMMA sales look
-- far too small (supplies ran at 300%+ of sales, which means sales is understated).
--
-- The app only adds a revenue row to Total Sales when its CHANNEL has
-- counts_in_total = true. A row can exist in the database and still be invisible
-- in every total if its channel is switched off, inactive, or missing.
--
-- Run each block and share the output.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) THE MOST LIKELY CAUSE: UMMA's channels and whether they count toward sales.
--    Any channel with counts_in_total = false is silently excluded from every total.
-- ---------------------------------------------------------------------------
SELECT c.code, c.name, c.counts_in_total, c.total_multiplier, c.active, c.display_order
FROM public.revenue_channels c
JOIN public.corporations co ON co.id = c.corporation_id
WHERE co.code = 'UMMA'
ORDER BY c.display_order;

-- ---------------------------------------------------------------------------
-- 2) Is the revenue actually in the database at all? By month and channel.
-- ---------------------------------------------------------------------------
SELECT
  to_char(r.date, 'YYYY-MM')          AS month,
  ch.code                             AS channel,
  ch.counts_in_total                  AS counts,
  count(*)                            AS rows,
  sum(r.amount)                       AS total,
  sum(r.amount) FILTER (WHERE ch.counts_in_total) AS counted_by_app
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
LEFT JOIN public.revenue_channels ch ON ch.id = r.channel_id
WHERE co.code = 'UMMA'
GROUP BY month, ch.code, ch.counts_in_total
ORDER BY month DESC, ch.code;

-- ---------------------------------------------------------------------------
-- 3) ORPHANS: revenue rows whose channel is missing or belongs to another corp.
--    These are dropped from every total without any warning.
-- ---------------------------------------------------------------------------
SELECT
  to_char(r.date, 'YYYY-MM') AS month,
  count(*)                   AS orphan_rows,
  sum(r.amount)              AS lost_amount
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
LEFT JOIN public.revenue_channels ch
       ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE co.code = 'UMMA'
  AND ch.id IS NULL
GROUP BY month
ORDER BY month DESC;

-- ---------------------------------------------------------------------------
-- 4) HEADLINE: what does the app total for UMMA, month by month?
--    Compare this straight against the Excel.
-- ---------------------------------------------------------------------------
SELECT
  to_char(r.date, 'YYYY-MM') AS month,
  sum(r.amount * COALESCE(ch.total_multiplier, 1))
    FILTER (WHERE ch.counts_in_total)          AS app_total_sales,
  sum(r.amount)                                AS all_rows_in_db,
  count(DISTINCT r.date)                       AS days_with_revenue
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
LEFT JOIN public.revenue_channels ch ON ch.id = r.channel_id
WHERE co.code = 'UMMA'
GROUP BY month
ORDER BY month DESC;

-- ---------------------------------------------------------------------------
-- 5) Compare UMMA against a store that works (FH), so the difference stands out.
-- ---------------------------------------------------------------------------
SELECT co.code AS corp, ch.code AS channel, ch.counts_in_total, ch.active
FROM public.revenue_channels ch
JOIN public.corporations co ON co.id = ch.corporation_id
WHERE co.code IN ('UMMA', 'FH')
ORDER BY co.code, ch.display_order;
