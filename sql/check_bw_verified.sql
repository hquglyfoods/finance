-- Do BW's early-July cash days actually have verified=true in daily_revenue?
-- The calendar shows them "Picked" but Count Envelopes shows "In store". Both read
-- the same column, so this checks what is really stored.
SELECT co.code AS store, dr.date, dr.amount, dr.verified, dr.pickup_id,
       dr.counted_amount
FROM public.daily_revenue dr
JOIN public.revenue_channels rc ON rc.id = dr.channel_id AND rc.code='cash'
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE co.code='BW' AND dr.date BETWEEN '2026-07-01' AND '2026-07-18'
ORDER BY dr.date;

-- Also: the pickups that should have set verified=true on those days.
SELECT cp.pickup_date, cp.period_start, cp.period_end, cp.counted_amount
FROM public.cash_pickups cp
JOIN public.corporations co ON co.id = cp.corporation_id
WHERE co.code='BW'
ORDER BY cp.period_start;
