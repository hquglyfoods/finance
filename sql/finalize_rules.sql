-- Finalize auto rules across all corps (idempotent; safe whatever you have already run).
-- Supersedes credit_card_fee_stores.sql and hq_ad_obligations_cleanup.sql.
--
-- Target end state:
--   Credit Card Fee (cc_fee):
--     AD, BW, FH = (ch_card + cat_tips) * 0.03   (3% of card sales AND 3% of card tips,
--                                                 since the processor charges the fee on
--                                                 the tip portion too)
--     UMMA       = ch_ugly * 0.03  (kept; UMMA has no card/tips, basis is its Sales channel)
--     HQ         = none (HQ has no card fee; mostly paid by check)
--   Other Obligations (other_obligations) = cat_payroll * 0.13 for every corp,
--     named "Other Obligations (WC, SS, etc)".
--   AD's old "insurance" auto rule (1000 + (payroll+tips)*0.03) is removed; GL insurance is
--     now a recurring expense in the Insurance category, like every store.
--
-- NOTE on cat_tips: this uses the tips category as the card-tip base. If cat_tips also
-- includes cash tips (which carry no card fee), the 3% would slightly overcount; tell me
-- if tips need to be split.

begin;

-- 1) AD: remove the old insurance auto rule.
delete from auto_expense_rules
 where corporation_id = (select id from corporations where code = 'AD')
   and code = 'insurance';

-- 2) Standardize every corp's Other Obligations to cat_payroll * 0.13 with the new name.
update auto_expense_rules
   set expr = 'cat_payroll * 0.13',
       name = 'Other Obligations (WC, SS, etc)'
 where code = 'other_obligations'
   and corporation_id in (select id from corporations where code in ('AD','BW','FH','HQ','UMMA'));

-- 2b) Create Other Obligations for any corp missing it (AD had none of its own).
insert into auto_expense_rules (corporation_id, code, name, expr, active, display_order)
select co.id, 'other_obligations', 'Other Obligations (WC, SS, etc)', 'cat_payroll * 0.13', true,
       coalesce((select max(r.display_order) from auto_expense_rules r where r.corporation_id = co.id), 0) + 1
  from corporations co
 where co.code in ('AD','BW','FH','HQ','UMMA')
   and not exists (
     select 1 from auto_expense_rules r2
      where r2.corporation_id = co.id and r2.code = 'other_obligations');

-- 3) Credit Card Fee for AD/BW/FH = 3% of card sales + 3% of card tips.
--    Update existing cc_fee rules...
update auto_expense_rules
   set expr = '(ch_card + cat_tips) * 0.03', name = 'Credit Card Fee'
 where code = 'cc_fee'
   and corporation_id in (select id from corporations where code in ('AD','BW','FH'));

--    ...and create cc_fee for any of AD/BW/FH still missing it.
insert into auto_expense_rules (corporation_id, code, name, expr, active, display_order)
select co.id, 'cc_fee', 'Credit Card Fee', '(ch_card + cat_tips) * 0.03', true,
       coalesce((select max(r.display_order) from auto_expense_rules r where r.corporation_id = co.id), 0) + 1
  from corporations co
 where co.code in ('AD','BW','FH')
   and not exists (
     select 1 from auto_expense_rules r2
      where r2.corporation_id = co.id and r2.code = 'cc_fee');

commit;

-- Verify:
--   select co.code as corp, r.code, r.name, r.expr, r.active
--     from auto_expense_rules r join corporations co on co.id = r.corporation_id
--    where co.code in ('AD','BW','FH','HQ','UMMA')
--      and r.code in ('cc_fee','processing_fee','other_obligations','insurance')
--    order by co.code, r.code;
