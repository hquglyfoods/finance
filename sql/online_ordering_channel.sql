-- Online Ordering (Toast self online ordering / Toast Delivery) as its own revenue channel
-- for AD, BW, FH. It is card-paid store-direct revenue, so it counts in total, is taxed by
-- the store sales_tax rule, and incurs the 3% credit card fee. It is NOT a 3PO marketplace
-- channel (no delivery commission). Idempotent. Past data stays in 'card'; this only splits
-- revenue going forward (once toast-sync is deployed with the 'online' mapping).

begin;

-- 1) Create the 'online' channel for each store (counts in total, active).
insert into revenue_channels (corporation_id, code, name, counts_in_total, total_multiplier, active, display_order)
select co.id, 'online', 'Online Ordering', true, 1, true,
       coalesce((select max(rc.display_order) from revenue_channels rc where rc.corporation_id = co.id), 0) + 1
  from corporations co
 where co.code in ('AD','BW','FH')
   and not exists (select 1 from revenue_channels rc2 where rc2.corporation_id = co.id and rc2.code = 'online');

-- 2) Credit Card Fee: online is card-paid, so include ch_online in the 3% fee for all three.
update auto_expense_rules
   set expr = '(ch_card + ch_online + cat_tips) * 0.03'
 where code = 'cc_fee'
   and corporation_id in (select id from corporations where code in ('AD','BW','FH'));

-- 3) Sales tax: BW/FH list channels explicitly, so add ch_online.
update auto_expense_rules
   set expr = '(ch_cash + ch_card + ch_online) * 0.08875'
 where code = 'sales_tax'
   and corporation_id in (select id from corporations where code in ('BW','FH'));
--    AD's sales_tax is total_sales-based; since 'online' counts_in_total, it is already
--    included automatically, so AD needs no change here.

commit;

-- Verify:
--   select co.code, rc.code, rc.name, rc.counts_in_total, rc.active
--     from revenue_channels rc join corporations co on co.id = rc.corporation_id
--    where co.code in ('AD','BW','FH') and rc.code = 'online' order by co.code;
--   select co.code, r.code, r.expr from auto_expense_rules r
--     join corporations co on co.id = r.corporation_id
--    where co.code in ('AD','BW','FH') and r.code in ('cc_fee','sales_tax') order by co.code, r.code;
