-- ============================================================================
-- A단계: 가맹점 자동 매칭 + 자동 timezone을 위한 corporations 컬럼 추가.
-- 모두 IF NOT EXISTS / nullable default라 기존 데이터에 안전 (idempotent).
-- ============================================================================

-- Toast 매장 GUID: 자동 매칭의 키. 이미 TOAST_RESTAURANTS env에 있는 값과 동일하지만,
-- DB에 저장해두면 env 없이도 매칭/표시가 가능하고 자동 발견의 기준이 됨.
ALTER TABLE public.corporations ADD COLUMN IF NOT EXISTS toast_guid text;

-- 매장 시간대 (Toast general.timeZone에서 취득, 예: 'America/New_York').
-- 영업일/동기화 계산에 사용. 하드코딩 CENTRAL 세트를 대체.
ALTER TABLE public.corporations ADD COLUMN IF NOT EXISTS timezone text;

-- Toast closeoutHour (영업일 마감 시각, 예: 4 = 새벽 4시). 있으면 더 정확한 영업일 경계.
ALTER TABLE public.corporations ADD COLUMN IF NOT EXISTS closeout_hour int;

-- 숨김: 폐점했거나 화면에서 안 보이게 할 매장. true면 Home/Insights에서 제외.
ALTER TABLE public.corporations ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

-- 자동 생성 표시: toast-sync가 자동으로 만든 corp인지 (수동 생성과 구분).
ALTER TABLE public.corporations ADD COLUMN IF NOT EXISTS auto_created boolean NOT NULL DEFAULT false;

-- 표시 이름: 화면에 보여줄 이름 (편집 가능). null이면 name을 그대로 사용.
-- Toast 이름이 "Ugly Donuts and Corndogs" 처럼 다 똑같아서, 사람이 알아볼 이름으로 덮어씀.
ALTER TABLE public.corporations ADD COLUMN IF NOT EXISTS display_name text;

-- toast_guid로 빠르게 매칭하기 위한 유니크 인덱스 (null은 충돌 안 함).
CREATE UNIQUE INDEX IF NOT EXISTS corporations_toast_guid_key
  ON public.corporations (toast_guid) WHERE toast_guid IS NOT NULL;

-- 기존 직영 3개 매장에 toast_guid와 timezone backfill (이미 아는 값).
UPDATE public.corporations SET toast_guid = '8390d4cb-1f49-46f7-a225-f48c53699964',
       timezone = 'America/New_York', closeout_hour = 4
WHERE code = 'AD' AND toast_guid IS NULL;
UPDATE public.corporations SET toast_guid = 'b83a5420-28bb-4144-86cd-e259e16779e5',
       timezone = 'America/New_York', closeout_hour = 4
WHERE code = 'BW' AND toast_guid IS NULL;
UPDATE public.corporations SET toast_guid = 'a9a30034-2974-4a26-b7ff-dcfa625bb2d5',
       timezone = 'America/New_York', closeout_hour = 4
WHERE code = 'FH' AND toast_guid IS NULL;

-- 확인
SELECT code, name, display_name, corp_type, toast_guid, timezone, closeout_hour, hidden, auto_created
FROM public.corporations
ORDER BY display_order, code;
