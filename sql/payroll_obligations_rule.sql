-- Payroll obligations (Social Security / Workers Comp ~= 13% of payroll) as an AUTO rule,
-- checked across all five corps: AD, BW, FH, HQ, UMMA.
--
-- The rule form is  cat_payroll * 0.13  (13% of the period's payroll category total),
-- the same shape as UMMA's existing rule. STEP 1 shows which corps already have it and
-- which are missing; STEP 2 adds it ONLY to corps that have no payroll-based rule yet.

-- ============================================================================
-- STEP 1 - DIAGNOSTIC (read-only). Run all three and read the summary (query 3).
-- ============================================================================

-- 1) Does each corp have a payroll expense category with code 'payroll'? (the rule needs it)
select co.code as corp,
       bool_or(ec.code = 'payroll') as has_payroll_category,
       max(case when ec.code = 'payroll' then ec.name end) as payroll_category_name
  from corporations co
  left join expense_categories ec on ec.corporation_id = co.id
 where co.code in ('AD','BW','FH','HQ','UMMA')
 group by co.code
 order by co.code;

-- 2) Every auto rule per corp, flagged. `looks_like_13pct` = references payroll AND ~0.13.
select co.code as corp, r.code, r.name, r.expr, r.active,
       (r.expr ilike '%cat_payroll%') as uses_payroll,
       (r.expr ilike '%cat_payroll%' and (r.expr ilike '%0.13%' or r.expr ilike '%.13%')) as looks_like_13pct
  from auto_expense_rules r
  join corporations co on co.id = r.corporation_id
 where co.code in ('AD','BW','FH','HQ','UMMA')
 order by co.code, r.display_order;

-- 3) SUMMARY: which corps already have a ~13%-of-payroll rule vs are MISSING one.
with corp_list as (
  select id, code from corporations where code in ('AD','BW','FH','HQ','UMMA')
),
have13 as (
  select distinct r.corporation_id
    from auto_expense_rules r
   where r.active
     and r.expr ilike '%cat_payroll%'
     and (r.expr ilike '%0.13%' or r.expr ilike '%.13%')
)
select cl.code as corp,
       case when h.corporation_id is not null then 'YES - has ~13% payroll rule'
            else 'MISSING' end as payroll_13_rule
  from corp_list cl
  left join have13 h on h.corporation_id = cl.id
 order by cl.code;

-- ============================================================================
-- STEP 2 - ADD (idempotent). Adds "Payroll Obligations (SS/WC 13%)" = cat_payroll * 0.13
-- ONLY to corps that currently have NO payroll-based auto rule. It will NOT touch corps
-- that already have one (e.g. UMMA's other_obligations), and will NOT overwrite a payroll
-- rule that exists at a different rate. If Step 1 shows a corp with a payroll rule at the
-- WRONG rate, fix that one by hand rather than relying on this insert.
--
-- Run only after Step 1, and only if 13% is the rate you want for the missing corps.
-- ============================================================================
begin;

insert into auto_expense_rules (corporation_id, code, name, expr, active, display_order)
select co.id, 'payroll_obligations', 'Payroll Obligations (SS/WC 13%)', 'cat_payroll * 0.13', true,
       coalesce((select max(r.display_order) from auto_expense_rules r where r.corporation_id = co.id), 0) + 1
  from corporations co
 where co.code in ('AD','BW','FH','HQ','UMMA')
   and not exists (
     select 1 from auto_expense_rules r2
      where r2.corporation_id = co.id
        and r2.expr ilike '%cat_payroll%');

commit;

-- Verify:
--   select co.code as corp, r.code, r.name, r.expr, r.active
--     from auto_expense_rules r join corporations co on co.id = r.corporation_id
--    where co.code in ('AD','BW','FH','HQ','UMMA') and r.expr ilike '%cat_payroll%'
--    order by co.code;
