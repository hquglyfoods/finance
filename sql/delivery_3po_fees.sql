-- 3PO (Uber Eats / DoorDash / GrubHub) cost handling for AD, BW, FH.
-- Revenue stays gross (the Toast channel amounts). Commission and marketplace tax are
-- booked as expenses via dedicated auto rules, and 3PO is removed from the store sales_tax
-- rule so it is not taxed twice. All 3PO fees now live in just two rules per store, so a
-- future rate change only touches those.
--
--   sales_tax (store direct sales only):
--     BW/FH : (ch_cash + ch_card) * 0.08875
--     AD    : (total_sales - cat_tips - ch_uber - ch_grubhub - ch_doordash) * 0.06625
--   delivery_commission = (ch_uber + ch_grubhub + ch_doordash) * 0.30
--   delivery_sales_tax  = (ch_uber + ch_grubhub + ch_doordash) * <state rate>
--                         (AD 0.06625, BW/FH 0.08875)
-- Idempotent.

begin;

-- 1) Remove 3PO from the store sales_tax rule. (popmenu is retired/inactive, so it is
--    dropped too; BW/FH store-direct sales are just cash + card.)
update auto_expense_rules
   set expr = '(ch_cash + ch_card) * 0.08875'
 where code = 'sales_tax'
   and corporation_id in (select id from corporations where code in ('BW','FH'));

update auto_expense_rules
   set expr = '(total_sales - cat_tips - ch_uber - ch_grubhub - ch_doordash) * 0.06625'
 where code = 'sales_tax'
   and corporation_id = (select id from corporations where code = 'AD');

-- 2) Delivery Commissions = 30% of 3PO gross (all three platforms). Update if present, else insert.
update auto_expense_rules
   set expr = '(ch_uber + ch_grubhub + ch_doordash) * 0.30', name = 'Delivery Commissions'
 where code = 'delivery_commission'
   and corporation_id in (select id from corporations where code in ('AD','BW','FH'));

insert into auto_expense_rules (corporation_id, code, name, expr, active, display_order)
select co.id, 'delivery_commission', 'Delivery Commissions', '(ch_uber + ch_grubhub + ch_doordash) * 0.30', true,
       coalesce((select max(r.display_order) from auto_expense_rules r where r.corporation_id = co.id), 0) + 1
  from corporations co
 where co.code in ('AD','BW','FH')
   and not exists (select 1 from auto_expense_rules r2 where r2.corporation_id = co.id and r2.code = 'delivery_commission');

-- 3) Delivery Sales Tax = 3PO gross * state rate (AD 6.625%, BW/FH 8.875%).
--    Set the expr explicitly per state so the rate is correct, then insert where missing.
update auto_expense_rules
   set expr = '(ch_uber + ch_grubhub + ch_doordash) * 0.06625', name = 'Delivery Sales Tax'
 where code = 'delivery_sales_tax'
   and corporation_id = (select id from corporations where code = 'AD');
update auto_expense_rules
   set expr = '(ch_uber + ch_grubhub + ch_doordash) * 0.08875', name = 'Delivery Sales Tax'
 where code = 'delivery_sales_tax'
   and corporation_id in (select id from corporations where code in ('BW','FH'));

insert into auto_expense_rules (corporation_id, code, name, expr, active, display_order)
select co.id, 'delivery_sales_tax', 'Delivery Sales Tax',
       case when co.code = 'AD' then '(ch_uber + ch_grubhub + ch_doordash) * 0.06625'
            else '(ch_uber + ch_grubhub + ch_doordash) * 0.08875' end,
       true,
       coalesce((select max(r.display_order) from auto_expense_rules r where r.corporation_id = co.id), 0) + 1
  from corporations co
 where co.code in ('AD','BW','FH')
   and not exists (select 1 from auto_expense_rules r2 where r2.corporation_id = co.id and r2.code = 'delivery_sales_tax');

commit;

-- Verify:
--   select co.code as corp, r.code, r.name, r.expr from auto_expense_rules r
--     join corporations co on co.id = r.corporation_id
--    where co.code in ('AD','BW','FH')
--      and r.code in ('sales_tax','delivery_commission','delivery_sales_tax')
--    order by co.code, r.code;
