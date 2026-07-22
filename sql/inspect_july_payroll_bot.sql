-- 7월 payroll_bot 행이 매장당 4개인 이유 확인.
-- 백필로 넣은 건 매장당 2개(payroll+payroll_tax)였는데 4개면 뭔가 더 있음.
-- slack_ts 접두사로 출처를 구분: manual_backfill_ = 우리가 넣은 것, hr_ = HR앱, pr_ = Slack봇
SELECT co.code AS store, ec.code AS category, e.date, e.amount,
       CASE WHEN e.slack_ts LIKE 'hr_%' THEN 'HR webhook'
            WHEN e.slack_ts LIKE 'pr_%' THEN 'Slack bot'
            WHEN e.slack_ts LIKE 'manual_backfill_%' THEN 'Manual backfill'
            ELSE COALESCE(e.slack_ts,'(none)') END AS via,
       e.slack_ts
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE co.code IN ('AD','BW','FH')
  AND ec.code IN ('payroll','payroll_tax')
  AND e.source = 'payroll_bot'
  AND e.date >= '2026-07-01' AND e.date <= '2026-07-31'
ORDER BY co.code, e.date, ec.code;
