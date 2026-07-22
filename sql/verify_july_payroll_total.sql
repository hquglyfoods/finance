-- 화면 "Where the Money Went · July 2026"의 Payroll/Payroll Tax 합계가
-- 실제 DB와 맞는지 검증.
-- 화면 값: Payroll $21,084.11, Payroll Tax $2,274.63
--
-- 주의: computePL은 payroll을 expense의 date가 속한 달로 잡음. period_end(주 마감일)이
-- 7월이면 7월에 잡힘. 아래로 7월에 date가 들어간 payroll을 소스별로 다 보여줌.

-- 1) 7월(date 기준) payroll / payroll_tax 전체 합계, 소스별
SELECT ec.code AS category, e.source,
       count(*) AS rows,
       ROUND(SUM(e.amount),2) AS total
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE co.code IN ('AD','BW','FH')
  AND ec.code IN ('payroll','payroll_tax')
  AND e.date >= '2026-07-01' AND e.date <= '2026-07-31'
  AND e.status = 'confirmed'
GROUP BY ec.code, e.source
ORDER BY ec.code, e.source;

-- 2) 합계만 (소스 무관) - 화면 값과 직접 비교
SELECT ec.code AS category, ROUND(SUM(e.amount),2) AS total_all_sources
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE co.code IN ('AD','BW','FH')
  AND ec.code IN ('payroll','payroll_tax')
  AND e.date >= '2026-07-01' AND e.date <= '2026-07-31'
  AND e.status = 'confirmed'
GROUP BY ec.code;

-- 3) 개별 행 나열 (어느 주가 포함/제외됐는지 눈으로 확인)
SELECT co.code AS store, ec.code AS category, e.date, e.amount, e.source,
       CASE WHEN e.slack_ts LIKE 'hr_%' THEN 'HR'
            WHEN e.slack_ts LIKE 'pr_%' THEN 'Slack'
            WHEN e.slack_ts LIKE 'manual_backfill_%' THEN 'Backfill'
            ELSE '(other)' END AS via
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE co.code IN ('AD','BW','FH')
  AND ec.code IN ('payroll','payroll_tax')
  AND e.date >= '2026-07-01' AND e.date <= '2026-07-31'
  AND e.status = 'confirmed'
ORDER BY ec.code, e.date, co.code;
