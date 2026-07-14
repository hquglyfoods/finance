-- ============================================================================
-- Is the DB actually holding the latest Toast figures right now?
--
-- The Home card renders exactly what this returns. If card_total here matches
-- what the card shows, the app is displaying the DB faithfully and the question
-- becomes WHEN the DB was last written (updated_at below). If card_total here is
-- HIGHER than the card, the app is not re-reading, which is a front-end bug.
-- ============================================================================
SELECT ch.name AS channel,
       r.amount,
       r.source,
       r.updated_at,                         -- when the sync last wrote this row
       ch.counts_in_total
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'AD'
LEFT JOIN public.revenue_channels ch
       ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE r.date = CURRENT_DATE
ORDER BY r.amount DESC;

SELECT ROUND(sum(CASE WHEN ch.counts_in_total
                      THEN r.amount * COALESCE(ch.total_multiplier,1) ELSE 0 END), 2) AS card_total_now,
       max(r.updated_at) AS last_written,
       now() AS server_time
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'AD'
LEFT JOIN public.revenue_channels ch
       ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
WHERE r.date = CURRENT_DATE;
