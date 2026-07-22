-- ============================================================================
-- 기존 PEARLAND corp에 Toast guid + timezone을 연결.
--
-- 왜 필요: B단계 자동 매칭은 toast_guid로 기존 매장을 알아봄. PEARLAND corp은
-- 이미 있지만 toast_guid가 null이라, 연결 안 하면 자동 매칭이 Pearland를 "새 매장"
-- 으로 보고 중복 corp을 또 만들어버림. 이 SQL로 기존 corp에 guid를 붙이면 자동
-- 매칭이 기존 걸 인식하고 중복을 안 만듦.
--
-- Pearland timezone: Toast가 확정해주는 값을 쓰는 게 정확하지만, TX는 Central이라
-- 우선 America/Chicago로 넣음. 다음 동기화에서 Toast config의 실제 timeZone으로
-- 자동 보정됨 (B단계 코드가 timezone 없으면 채우고, 있으면 둠).
-- idempotent.
-- ============================================================================

-- STEP 1: 미리보기 (현재 상태)
SELECT code, name, corp_type, toast_guid, timezone, closeout_hour
FROM public.corporations WHERE code = 'PEARLAND';

-- STEP 2: guid + timezone 연결 (아직 비어있을 때만)
UPDATE public.corporations
SET toast_guid = '49864719-445d-4652-91f4-8f941d0c2cf2',
    timezone = COALESCE(timezone, 'America/Chicago'),
    closeout_hour = COALESCE(closeout_hour, 4)
WHERE code = 'PEARLAND'
  AND (toast_guid IS NULL OR toast_guid = '49864719-445d-4652-91f4-8f941d0c2cf2');

-- STEP 3: 확인
SELECT code, name, corp_type, toast_guid, timezone, closeout_hour, hidden
FROM public.corporations WHERE code = 'PEARLAND';
