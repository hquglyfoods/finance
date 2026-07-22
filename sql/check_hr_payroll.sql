-- ============================================================================
-- HR app payroll webhook 진단: HR이 보낸 payroll이 Finance DB에 들어왔는지 확인.
--
-- HR webhook(payroll-ingest)이 저장하는 행은 slack_ts가 'hr_'로 시작해.
-- (Slack 경로는 'pr_', 수동 백필은 'manual_backfill_'.)
-- 이 쿼리로 HR 경로가 실제로 뭔가 저장했는지 바로 알 수 있어.
-- ============================================================================

-- 1) HR이 보낸 payroll 행이 하나라도 있나? (slack_ts LIKE 'hr_%')
SELECT co.code AS store, ec.code AS category, e.date, e.amount, e.status, e.slack_ts, e.created_at
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE e.slack_ts LIKE 'hr_%'
ORDER BY e.date DESC, co.code, ec.code;

-- 2) 최근 payroll 전체 (경로 구분해서). 어느 경로로 들어왔는지 한눈에.
SELECT co.code AS store, ec.code AS category, e.date, e.amount,
       CASE WHEN e.slack_ts LIKE 'hr_%' THEN 'HR webhook'
            WHEN e.slack_ts LIKE 'pr_%' THEN 'Slack bot'
            WHEN e.slack_ts LIKE 'manual_backfill_%' THEN 'Manual backfill'
            ELSE COALESCE(e.slack_ts,'(none)') END AS via
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE ec.code IN ('payroll','payroll_tax')
  AND e.date >= CURRENT_DATE - 45
ORDER BY e.date DESC, co.code, ec.code;

-- 3) payroll / payroll_tax 카테고리가 세 매장에 다 존재하나?
--    (없으면 webhook이 그 매장 행을 건너뛰어서 조용히 저장 안 됨.)
SELECT co.code AS store,
       bool_or(ec.code='payroll')     AS has_payroll_cat,
       bool_or(ec.code='payroll_tax') AS has_payroll_tax_cat
FROM public.corporations co
LEFT JOIN public.expense_categories ec
  ON ec.corporation_id = co.id AND ec.code IN ('payroll','payroll_tax')
WHERE co.code IN ('AD','BW','FH')
GROUP BY co.code
ORDER BY co.code;
