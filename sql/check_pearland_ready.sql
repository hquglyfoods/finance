-- Pearland가 Toast 자동 연동을 받을 준비가 됐는지 확인.
-- (corporation 존재 + franchisee 타입 + 매출 채널 존재)

-- 1) Pearland corporation이 있고 franchisee 타입인가?
SELECT id, code, name, corp_type, display_order
FROM public.corporations
WHERE code = 'PEARLAND';
-- 기대: corp_type = 'franchisee' 인 행 1개. 없으면 corporation부터 만들어야 함.

-- 2) Pearland에 매출 채널이 있나? (Toast가 매출을 넣을 자리)
SELECT rc.code, rc.name, rc.counts_in_total, rc.total_multiplier, rc.active
FROM public.revenue_channels rc
JOIN public.corporations co ON co.id = rc.corporation_id
WHERE co.code = 'PEARLAND'
ORDER BY rc.display_order, rc.code;
-- 기대: cash, card, uber, grubhub, doordash 등. 없으면 채널 생성 필요.

-- 3) 이미 Pearland 매출 데이터가 있나? (수동 입력분 등)
SELECT COUNT(*) AS revenue_rows,
       MIN(dr.date) AS earliest, MAX(dr.date) AS latest,
       ROUND(SUM(dr.amount),2) AS total_amount
FROM public.daily_revenue dr
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE co.code = 'PEARLAND';
