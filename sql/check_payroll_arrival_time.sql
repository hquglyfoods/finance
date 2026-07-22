-- payroll 행이 각각 언제 DB에 들어왔는지 (created_at) 확인.
-- 방금 HR/Slack에서 보낸 게 실제로 저장됐는지, 언제 도착했는지 알 수 있음.
-- created_at은 UTC로 저장됨. America/New_York(동부) 시각으로도 같이 보여줌.
SELECT co.code AS store, ec.code AS category, e.date AS period_end, e.amount,
       CASE WHEN e.slack_ts LIKE 'hr_%' THEN 'HR webhook'
            WHEN e.slack_ts LIKE 'pr_%' THEN 'Slack bot'
            WHEN e.slack_ts LIKE 'manual_backfill_%' THEN 'Manual backfill'
            ELSE COALESCE(e.slack_ts,'(none)') END AS via,
       e.created_at AS created_utc,
       e.created_at AT TIME ZONE 'America/New_York' AS created_eastern,
       e.slack_ts
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE co.code IN ('AD','BW','FH')
  AND ec.code IN ('payroll','payroll_tax')
  AND e.source = 'payroll_bot'
ORDER BY e.created_at DESC;
