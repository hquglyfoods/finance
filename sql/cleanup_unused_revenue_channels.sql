-- Retire unused revenue channels (preview first, then remove). Covers:
--   AD      : "Deliveries (Board)"
--   BW, FH  : "Cash (2nd col)" and "Delivery App (board)"
--   HQ      : "Cash (memo)"
--
-- Preview shows how many historical rows each channel holds. Delete only the ones with
-- 0 rows (the DELETE block below has a safety guard that skips any channel that still has
-- rows). For a channel that DOES have history, deactivate it instead (STEP 2) so past P&L
-- stays intact.

-- ============================================================================
-- STEP 1 - PREVIEW (read-only). Confirm names and row counts.
-- ============================================================================
select co.code as corp, rc.id, rc.code, rc.name, rc.active,
       (select count(*) from daily_revenue d where d.channel_id = rc.id) as revenue_rows
  from revenue_channels rc
  join corporations co on co.id = rc.corporation_id
 where (co.code = 'AD' and  rc.name ilike 'deliver%board%')
    or (co.code = 'BW' and (rc.name ilike 'cash%2nd%col%' or rc.name ilike 'deliver%board%'))
    or (co.code = 'FH' and (rc.name ilike 'cash%2nd%col%' or rc.name ilike 'deliver%board%'))
    or (co.code = 'HQ' and  rc.name ilike 'cash%memo%')
 order by corp, rc.name;

-- ============================================================================
-- STEP 2 - DEACTIVATE (safe default; keeps history, hides from entry/P&L).
-- ============================================================================
begin;
update revenue_channels rc
   set active = false
  from corporations co
 where co.id = rc.corporation_id
   and (
        (co.code = 'AD' and  rc.name ilike 'deliver%board%')
     or (co.code = 'BW' and (rc.name ilike 'cash%2nd%col%' or rc.name ilike 'deliver%board%'))
     or (co.code = 'FH' and (rc.name ilike 'cash%2nd%col%' or rc.name ilike 'deliver%board%'))
     or (co.code = 'HQ' and  rc.name ilike 'cash%memo%')
   );
commit;

-- ============================================================================
-- OPTIONAL - DELETE (only channels the preview showed with revenue_rows = 0). Run this
-- INSTEAD of STEP 2 if you want them fully gone. The NOT EXISTS guard protects any that
-- still hold rows.
-- ============================================================================
-- begin;
-- delete from revenue_channels rc
--  using corporations co
--  where co.id = rc.corporation_id
--    and (
--         (co.code = 'AD' and  rc.name ilike 'deliver%board%')
--      or (co.code = 'BW' and (rc.name ilike 'cash%2nd%col%' or rc.name ilike 'deliver%board%'))
--      or (co.code = 'FH' and (rc.name ilike 'cash%2nd%col%' or rc.name ilike 'deliver%board%'))
--      or (co.code = 'HQ' and  rc.name ilike 'cash%memo%')
--    )
--    and not exists (select 1 from daily_revenue d where d.channel_id = rc.id);
-- commit;
