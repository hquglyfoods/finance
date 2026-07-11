-- ============================================================================
-- HQ 2026-02 REVENUE fix.
--
-- The diagnostic showed the DB's February revenue is the TRUE February data
-- (Ingredients 38,921.00 + Royalty 6,001.11 + Others 6,116.14 = 51,038.25),
-- plus one -74.62 "plug" row on 2026-02-28 that was added to force the month
-- down to the Excel board's stale figure (50,963.63, which was really March).
--
-- Fix: delete that one plug row. February then equals the true Excel value.
-- (The Excel board itself still needs its 7 formulas repointed from
-- '2026-03' to '2026-02': cells AR6, AR7, AR8, AR15, AR16, AR17, AR18.)
-- ============================================================================

-- 1) SHOW the plug row.
SELECT r.id, r.date, r.amount, r.source, ch.name AS channel
FROM public.daily_revenue r
LEFT JOIN public.revenue_channels ch ON ch.id = r.channel_id
WHERE r.id = 'f9aedb4d-30db-46a9-8ed0-6cd1eb51ffa9';

-- 2) DELETE it. Guarded by id AND the exact values, so it cannot touch
--    anything else.
DELETE FROM public.daily_revenue
WHERE id = 'f9aedb4d-30db-46a9-8ed0-6cd1eb51ffa9'
  AND date = '2026-02-28'
  AND amount = -74.62
  AND source = 'board'
RETURNING id, date, amount;

-- 3) VERIFY: February board revenue must now total 51,038.25.
SELECT sum(r.amount) AS feb_board_total_should_be_51038_25
FROM public.daily_revenue r
JOIN public.corporations co ON co.id = r.corporation_id AND co.code = 'HQ'
WHERE r.source = 'board'
  AND r.date >= '2026-02-01' AND r.date < '2026-03-01';
