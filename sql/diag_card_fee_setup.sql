-- Diagnostic (read-only) to design the Credit Card Fee (3%) setup for AD, BW, FH.
-- Paste all three results back so the fix can be written with no double-counting.

-- 1) Revenue channels per store. We need to know whether CARD sales are a separate channel
--    (so the fee can be 3% of card sales -> ch_<code> * 0.03) or whether revenue is not
--    split by payment type (then the practical basis is total_sales * 0.03).
select co.code as corp, rc.code as channel_code, rc.name, rc.counts_in_total, rc.active
  from revenue_channels rc
  join corporations co on co.id = rc.corporation_id
 where co.code in ('AD','BW','FH')
 order by co.code, rc.display_order;

-- 2) Current auto rules per store (look for card_fee / other_obligations and their exprs;
--    this shows where a 3% is currently living and whether it is on total_sales).
select co.code as corp, r.code, r.name, r.expr, r.active
  from auto_expense_rules r
  join corporations co on co.id = r.corporation_id
 where co.code in ('AD','BW','FH')
 order by co.code, r.display_order;

-- 3) Expense categories that mention credit card or obligations (to see AD's existing
--    "Credit Card Fees" category and any overlap).
select co.code as corp, ec.code, ec.name, ec.active
  from expense_categories ec
  join corporations co on co.id = ec.corporation_id
 where co.code in ('AD','BW','FH')
   and (ec.name ilike '%credit%card%' or ec.name ilike '%card fee%' or ec.name ilike '%obligation%')
 order by co.code, ec.name;
