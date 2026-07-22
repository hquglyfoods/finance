-- ============================================================================
-- payroll_tax 카테고리를 active=true로 켜기 (AD/BW/FH).
--
-- 왜: payroll은 active=true인데 payroll_tax만 active=false라서, 카테고리를 active로
-- 거르는 화면(수동 expense 입력 드롭다운 등)에서 payroll tax가 안 보임. payroll과
-- 짝이 되는 항목이라 같이 active인 게 자연스럽고, HR/봇이 넣는 payroll tax 비용을
-- 화면에서 정상적으로 다루려면 켜는 게 맞음.
--
-- computePL의 P&L 총계는 "금액 있으면 표시"라 active와 무관하게 이미 집계되지만,
-- 이 SQL은 화면 카테고리 목록/드롭다운의 일관성을 위해 켜는 것.
--
-- idempotent: 이미 active=true면 아무것도 안 바뀜.
-- ============================================================================

-- STEP 1: 미리보기 (바뀔 행)
SELECT co.code AS store, ec.code AS category, ec.active AS current_active
FROM public.expense_categories ec
JOIN public.corporations co ON co.id = ec.corporation_id
WHERE co.code IN ('AD','BW','FH')
  AND ec.code = 'payroll_tax'
  AND ec.active IS DISTINCT FROM true;

-- STEP 2: 켜기
UPDATE public.expense_categories ec
SET active = true
FROM public.corporations co
WHERE ec.corporation_id = co.id
  AND co.code IN ('AD','BW','FH')
  AND ec.code = 'payroll_tax'
  AND ec.active IS DISTINCT FROM true;

-- STEP 3: 확인 (payroll, payroll_tax 둘 다 active=true여야)
SELECT co.code AS store, ec.code AS category, ec.active
FROM public.expense_categories ec
JOIN public.corporations co ON co.id = ec.corporation_id
WHERE co.code IN ('AD','BW','FH') AND ec.code IN ('payroll','payroll_tax')
ORDER BY co.code, ec.code;
