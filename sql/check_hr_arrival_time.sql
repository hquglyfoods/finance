-- HR webhook(payroll-ingest)으로 들어온 payroll 행만, 도착 시각과 함께 조회.
-- slack_ts가 'hr_'로 시작하는 게 HR 경로. created_at으로 언제 들어왔는지 확인.
SELECT co.code AS store, ec.code AS category, e.date AS period_end, e.amount,
       e.created_at AS created_utc,
       e.created_at AT TIME ZONE 'America/New_York' AS created_eastern,
       e.slack_ts
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE e.slack_ts LIKE 'hr_%'
ORDER BY e.created_at DESC;

-- 만약 위가 비어있으면 = HR 경로로 들어온 게 아직 없음.
-- (방금 화면에서 본 payroll은 Slack봇/백필 데이터일 것. 아래로 전체 확인 가능)
