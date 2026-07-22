-- Pearland 자동 매칭이 실제로 돌았는지 확인.

-- 1) Pearland corp 상태 (guid 붙었는지, timezone, 중복 없는지)
SELECT code, name, display_name, corp_type, toast_guid, timezone, closeout_hour, hidden, auto_created
FROM public.corporations
WHERE toast_guid = '49864719-445d-4652-91f4-8f941d0c2cf2'
   OR code = 'PEARLAND';
-- 기대: 1줄 (중복 없음). toast_guid 붙어있고, timezone America/Chicago.
-- 만약 2줄이면 중복 생성된 것 -> 알려주세요.

-- 2) Pearland에 매출 채널이 있나?
SELECT rc.code, rc.name, rc.active
FROM public.revenue_channels rc
JOIN public.corporations co ON co.id = rc.corporation_id
WHERE co.code = 'PEARLAND' OR co.toast_guid = '49864719-445d-4652-91f4-8f941d0c2cf2'
ORDER BY rc.display_order;

-- 3) Pearland 매출 데이터가 들어왔나? (toast 소스)
SELECT dr.date, dr.source, COUNT(*) AS rows, ROUND(SUM(dr.amount),2) AS total
FROM public.daily_revenue dr
JOIN public.corporations co ON co.id = dr.corporation_id
WHERE (co.code = 'PEARLAND' OR co.toast_guid = '49864719-445d-4652-91f4-8f941d0c2cf2')
GROUP BY dr.date, dr.source
ORDER BY dr.date DESC
LIMIT 20;
-- 비어있으면: 아직 동기화가 Pearland 매출을 안 가져온 것.
