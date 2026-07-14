-- ============================================================================
-- Why does the Home card differ from Toast?
-- Shows every channel's amount for today and whether it counts toward the card
-- total, so the gap can be attributed exactly.
--
-- The app's card total = SUM(amount * total_multiplier) for channels with
-- counts_in_total = true. Tips are a separate channel/category and are NOT
-- part of sales. Toast's own "Total Sales" screen may include tips, so a gap
-- roughly equal to the tips figure is expected, not a bug.
-- ============================================================================
SELECT co.code AS corp,
       ch.name AS channel,
       ch.code AS channel_code,
       r.amount,
       ch.counts_in_total,
       ch.total_multiplier,
       CASE WHEN ch.counts_in_total
            THEN ROUND(r.amount * COALESCE(ch.total_multiplier,1), 2)
            ELSE 0 END AS counted_toward_card,
       r.source
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id
LEFT JOIN public.revenue_channels ch
       ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE r.date = CURRENT_DATE AND co.code = 'AD'
ORDER BY ch.counts_in_total DESC, r.amount DESC;

-- Card total vs everything recorded (the difference is the excluded channels).
SELECT ROUND(sum(CASE WHEN ch.counts_in_total
                      THEN r.amount * COALESCE(ch.total_multiplier,1) ELSE 0 END), 2) AS card_total,
       ROUND(sum(r.amount), 2) AS all_channels_including_excluded,
       ROUND(sum(CASE WHEN ch.counts_in_total THEN 0 ELSE r.amount END), 2) AS excluded_amount
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'AD'
LEFT JOIN public.revenue_channels ch
       ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE r.date = CURRENT_DATE;
