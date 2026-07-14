-- Which revenue channels exist per corp, and what are their codes?
-- Needed so the app can decide which channels accept SEVERAL entries a day
-- (stores: Other Income only; HQ and UMMA: all of them).
SELECT co.code AS corp, ch.code AS channel_code, ch.name AS channel_name,
       ch.active, ch.counts_in_total, ch.display_order
FROM public.revenue_channels ch
JOIN public.corporations co ON co.id = ch.corporation_id
ORDER BY co.code, ch.display_order, ch.name;
