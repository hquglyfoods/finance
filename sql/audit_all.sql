-- AUDIT (read-only, ONE result table). Supabase's SQL editor shows only the LAST query's
-- result when several are run together, so everything is combined here into a single query.
-- Paste the whole result table back.
--
-- Columns:
--   section = 1-channel | 2-rule | 3-category
--   corp    = AD/BW/FH/HQ/UMMA
--   code    = channel/rule/category code
--   name    = display name
--   detail  = for channels: counts_in_total flag; for rules: the expr; for categories: (blank)
--   active

select section, corp, code, name, detail, active from (
  -- revenue channels
  select '1-channel' as section, co.code as corp, rc.code as code, rc.name as name,
         ('counts_in_total=' || rc.counts_in_total) as detail, rc.active as active,
         co.code as corp_sort, rc.display_order as ord
    from revenue_channels rc
    join corporations co on co.id = rc.corporation_id
   where co.code in ('AD','BW','FH','HQ','UMMA')

  union all
  -- auto expense rules
  select '2-rule', co.code, r.code, r.name, r.expr, r.active,
         co.code, r.display_order
    from auto_expense_rules r
    join corporations co on co.id = r.corporation_id
   where co.code in ('AD','BW','FH','HQ','UMMA')

  union all
  -- key expense categories only
  select '3-category', co.code, ec.code, ec.name, ''::text, ec.active,
         co.code, ec.display_order
    from expense_categories ec
    join corporations co on co.id = ec.corporation_id
   where co.code in ('AD','BW','FH','HQ','UMMA')
     and (ec.name ilike '%credit%card%' or ec.name ilike '%card fee%'
          or ec.name ilike '%insurance%' or ec.name ilike '%shipping%'
          or ec.name ilike '%obligation%' or ec.name ilike '%processing%')
) x
order by section, corp_sort, ord, code;
