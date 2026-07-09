-- UMMA restructure - Option B (merge history) + auto-rule cleanup. Preview, then apply.
-- Idempotent: safe to run whether or not an earlier partial version was already applied.
--
--   A. Revenue channels -> just "Sales" and "Other income".
--      Rename "Ugly Donuts" -> "Sales"; MERGE past "Franchise clients" + "Others"
--      daily_revenue INTO Sales (summed per date), delete the moved rows, deactivate those
--      channels. Keep "Other income".
--   B. Expense category "Shipping & Processing Fee" -> "Shipping".
--   C. Auto-rule cleanup:
--      - Delete duplicate "card_fee" (it was the same 3%-of-sales as Processing Fee).
--      - Fix "other_obligations": drop the erroneous "+ 3% of sales", keep SS/WC 13% of payroll.
--      - Keep ONE "Processing Fee" = 3% of SALES only (Other income excluded):
--          expr = ch_<sales_code> * 0.03   (built from the Sales channel's own code).
--
-- daily_revenue is UNIQUE on (corporation_id, channel_id, date); the merge adds onto an
-- existing Sales row, inserts where none exists, then deletes sources (no unique clash).
--
-- SAFETY: STEP 2 is one transaction. To rehearse, change the final COMMIT to ROLLBACK,
-- run, inspect, then switch back. Optional backup first:
--   create table daily_revenue_backup_umma as
--   select * from daily_revenue where corporation_id in
--     (select id from corporations where code ilike 'umma' or name ilike '%umma%');

-- ============================================================================
-- STEP 1 - PREVIEW (read-only). Confirm channel names, merge volume, and current rules.
-- ============================================================================
select id, code, name from corporations
 where code ilike 'umma' or name ilike '%umma%';

select id, code, name, counts_in_total, active
  from revenue_channels
 where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
 order by display_order;

select rc.name, count(*) as rows, coalesce(sum(d.amount),0) as total_amount
  from daily_revenue d
  join revenue_channels rc on rc.id = d.channel_id
 where rc.corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
   and (rc.name ilike 'franchise%' or rc.name ilike 'others')
 group by rc.name;

select code, name, expr, active from auto_expense_rules
 where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
 order by display_order;

-- ============================================================================
-- STEP 2 - APPLY. Only after Step 1 looks right. Adjust ilike patterns if names differ.
-- ============================================================================
begin;

-- A1. Rename the main sales channel to "Sales" (keeps id, code, history).
update revenue_channels
   set name = 'Sales'
 where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
   and name ilike 'ugly%donut%';

-- A2a. Add each date's source-channel total onto the EXISTING Sales row for that date.
update daily_revenue d
   set amount = d.amount + agg.total, updated_at = now()
  from (
    select date, sum(amount) as total
      from daily_revenue
     where channel_id in (
       select id from revenue_channels
        where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
          and (name ilike 'franchise%' or name ilike 'others'))
     group by date
  ) agg
 where d.date = agg.date
   and d.channel_id = (
     select id from revenue_channels
      where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
        and name = 'Sales');

-- A2b. Where a date has source rows but NO Sales row, create the Sales row = source total.
insert into daily_revenue (corporation_id, channel_id, date, amount, source, updated_at)
select (select id from corporations where code ilike 'umma' or name ilike '%umma%'),
       (select id from revenue_channels
         where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
           and name = 'Sales'),
       agg.date, agg.total, 'manual', now()
  from (
    select date, sum(amount) as total
      from daily_revenue
     where channel_id in (
       select id from revenue_channels
        where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
          and (name ilike 'franchise%' or name ilike 'others'))
     group by date
  ) agg
 where not exists (
   select 1 from daily_revenue s
    where s.date = agg.date
      and s.channel_id = (
        select id from revenue_channels
         where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
           and name = 'Sales'));

-- A2c. Delete the now-merged source rows.
delete from daily_revenue
 where channel_id in (
   select id from revenue_channels
    where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
      and (name ilike 'franchise%' or name ilike 'others'));

-- A3. Deactivate the emptied source channels (history preserved, now hold no rows).
update revenue_channels
   set active = false
 where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
   and (name ilike 'franchise%' or name ilike 'others');

-- B. Rename the combined expense category to just "Shipping".
update expense_categories
   set name = 'Shipping'
 where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
   and name ilike '%shipping%processing%';

-- C1. Remove the duplicate card fee (same 3%-of-sales as Processing Fee). No rule references it.
delete from auto_expense_rules
 where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
   and code = 'card_fee';

-- C2. Remove the erroneous "+ 3% of sales" from Other Obligations; keep SS/WC 13% of payroll.
update auto_expense_rules
   set expr = 'cat_payroll * 0.13',
       name = 'Other Obligations (SS/WC 13%)'
 where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
   and code = 'other_obligations';

-- C3. Single Processing Fee = 3% of SALES only (Other income excluded). Update the existing
--     rule's basis to the Sales channel's code; insert it if it does not exist.
update auto_expense_rules r
   set expr = 'ch_' || s.code || ' * 0.03', name = 'Credit Card Fee', active = true
  from revenue_channels s
 where r.code = 'processing_fee'
   and s.corporation_id = r.corporation_id
   and s.name = 'Sales'
   and r.corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%');

insert into auto_expense_rules (corporation_id, code, name, expr, active, display_order)
select c.id, 'processing_fee', 'Credit Card Fee', 'ch_' || s.code || ' * 0.03', true,
       coalesce((select max(r.display_order) from auto_expense_rules r where r.corporation_id = c.id), 0) + 1
  from corporations c
  join revenue_channels s on s.corporation_id = c.id and s.name = 'Sales'
 where (c.code ilike 'umma' or c.name ilike '%umma%')
   and not exists (
     select 1 from auto_expense_rules r2
      where r2.corporation_id = c.id and r2.code = 'processing_fee');

commit;

-- Verify after applying (processing_fee.expr should read ch_<code> * 0.03, NOT total_sales;
-- other_obligations should be cat_payroll * 0.13; card_fee should be gone):
--   select code, name, expr, active from auto_expense_rules
--    where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
--    order by display_order;
--   select code, name, counts_in_total, active from revenue_channels
--    where corporation_id in (select id from corporations where code ilike 'umma' or name ilike '%umma%')
--    order by display_order;
