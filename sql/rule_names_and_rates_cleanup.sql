-- Clean up auto-rule display names (drop hardcoded numbers, since the rate can change and
-- lives in the Rates tab / rate_schedule, not in the name) and remove the unused
-- sales_commission rate.

begin;

-- Royalty rate is royalty_rate (Rates tab), not a fixed 3%.
update auto_expense_rules set name = 'Royalty'       where code = 'royalty';
-- Marketing already uses marketing_rate; keep the name clean.
update auto_expense_rules set name = 'Marketing Fee' where code = 'marketing';
-- Payroll Tax rate lives in the expr; drop the number from the name.
update auto_expense_rules set name = 'Payroll Tax'   where code = 'payroll_tax';

-- Sales Tax: keep the state, drop the percentage number.
update auto_expense_rules set name = 'Sales Tax (NJ)'
 where code = 'sales_tax' and corporation_id = (select id from corporations where code = 'AD');
update auto_expense_rules set name = 'Sales Tax (NY)'
 where code = 'sales_tax' and corporation_id in (select id from corporations where code in ('BW','FH'));

-- Sales Commission is not used by any rule; remove its rate rows so it stops appearing.
delete from rate_schedule where rate_type = 'sales_commission';

commit;

-- Verify:
--   select co.code as corp, r.code, r.name from auto_expense_rules r
--     join corporations co on co.id=r.corporation_id
--    where r.code in ('royalty','marketing','payroll_tax','sales_tax')
--    order by co.code, r.code;
--   select distinct rate_type from rate_schedule order by rate_type;
