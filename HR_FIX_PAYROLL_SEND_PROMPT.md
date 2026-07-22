# Prompt to paste into the Ugly HR (uglyhr) app chat

아래 선 밑을 전부 복사해서 HR 앱 채팅에 붙여넣으세요.

---

주간 payroll을 Finance 앱으로 전송하는 기능이 실제로 안 보내지고 있어. 진단하고 고쳐줘.

## 증상 (핵심 단서)

Finance 쪽 webhook 함수(`payroll-ingest`)의 Netlify 로그에 **요청이 아예 안 찍혀.** 즉 HR 앱이 payroll을 전송한다고 하는데, 실제로는 Finance 서버에 요청이 도착조차 안 하고 있어. Finance 함수 자체는 살아있어 (브라우저로 URL 열면 405 "POST only" 응답이 옴). 그러니 문제는 HR 쪽 전송 코드야.

## 확인해줘

1. HR 앱에서 payroll을 close/전송할 때 **실제로 `fetch`(또는 POST 요청)를 보내는 코드가 있는지**, 그리고 그게 호출되고 있는지. 버튼만 있고 전송 코드가 없거나, 조건에 걸려서 실행이 안 되는 건 아닌지.
2. 전송 대상 URL을 **`FINANCE_WEBHOOK_URL` 환경변수에서 읽는지.** 하드코딩됐거나, env를 못 읽고 있거나, 값이 비어 있으면 요청이 엉뚱한 데로 가거나 안 감.
3. 이 앱이 순수 클라이언트(브라우저)에서 fetch를 직접 하는 구조인지, 아니면 서버(netlify function)를 거치는지. 클라이언트에서 직접 외부로 POST하면 CORS나 시크릿 노출 문제가 생길 수 있어. 그런 경우 HR 쪽에도 작은 프록시 함수를 두고 거기서 Finance로 POST하는 게 맞아.
4. 전송할 때 **에러를 삼키고 있지 않은지** (try/catch로 잡고 아무 표시 안 하거나, await 안 해서 실패를 모르는지). 실패하면 화면에 명확히 보여줘야 해.

## Finance webhook이 받는 정확한 형식 (이대로 보내야 함)

- **Method**: POST
- **URL**: 환경변수 `FINANCE_WEBHOOK_URL`
  (값: `https://uglyfinance.netlify.app/.netlify/functions/payroll-ingest`)
- **Headers**:
  - `Content-Type: application/json`
  - `X-Payroll-Token: <PAYROLL_INGEST_TOKEN 값>`  (환경변수 `PAYROLL_INGEST_TOKEN`에서 읽어서 넣어야 함. Finance 쪽에 설정된 값과 **정확히 같아야** 함. 안 맞으면 Finance가 401로 거부함.)
- **Body** (JSON):
```json
{
  "period_end": "2026-07-12",
  "entries": [
    { "store": "AD", "payroll": 6210.88, "payroll_tax": 682.58 },
    { "store": "BW", "payroll": 5778.30, "payroll_tax": 514.09 },
    { "store": "FH", "payroll": 4025.16, "payroll_tax": 350.99 }
  ],
  "source_note": "HR app",
  "correction": false
}
```

### 필드 규칙 (Finance가 검증함, 어기면 4xx로 거부)

- `period_end`: 주를 마감하는 **일요일**, `YYYY-MM-DD`. 그리고 **최근 60일 이내 날짜**여야 함. 60일보다 오래된 주차를 보내면 Finance가 400으로 거부해. (오래된 주 backfill은 이 경로 말고 별도로 처리.)
- `entries`: 매장별 한 항목. `store`는 정확히 `"AD"`, `"BW"`, `"FH"`. 값이 0인 매장은 빼도 됨.
- `payroll`: 그 매장 gross pay 총액 (숫자, 문자열 X, "$"나 콤마 없이).
- `payroll_tax`: 그 매장 employer taxes 총액 (숫자).
- `correction`: 최초 전송은 `false`(또는 생략). 이미 보낸 주를 고쳐 다시 보낼 때만 `true`.

## Finance 응답 처리

- 성공: HTTP 200, `{ "ok": true, "saved": n, "corrected": n, "skipped": n, ... }`
  → "Payroll을 Finance로 보냄 (n건 저장)" 같은 토스트. `saved`와 `corrected`가 0이고 `skipped`>0이면 "이미 전송된 주"로 안내.
- 실패:
  - 401 → 토큰 불일치. "Finance 인증 실패 (토큰 확인)" 표시.
  - 400 / 422 → `error`/`detail` 텍스트를 그대로 보여줘서 뭐가 문제인지 알 수 있게.
  - 네트워크 오류 → 재시도 옵션. 같은 주 재전송은 안전함 (Finance가 매장+주 단위로 중복 방지).

## 디버깅 도움

고친 뒤, 전송 버튼을 눌렀을 때 **브라우저 콘솔이나 앱 화면에 실제 요청 결과(HTTP 상태 코드와 응답 본문)를 한 번 찍어줘.** 그래야 Finance에 도착했는지, 어떤 응답을 받는지 바로 확인할 수 있어. 지금은 그게 안 보여서 어디서 막히는지 모르는 상태야.

## 환경변수 확인

- `FINANCE_WEBHOOK_URL` = `https://uglyfinance.netlify.app/.netlify/functions/payroll-ingest` (설정됨)
- `PAYROLL_INGEST_TOKEN` = Finance 쪽과 같은 값이어야 함. 이 앱 env에 이 이름으로 있는지 확인하고, 코드가 이 env를 읽어서 `X-Payroll-Token` 헤더에 넣는지 확인해줘. (클라이언트 전용 앱이면 이 시크릿을 브라우저에 노출하면 안 되니, HR 쪽 프록시 함수를 통해 보내야 함.)

## 하지 말 것

기존 payroll 계산 로직은 건드리지 마. 이건 이미 계산된 매장별 총액을 Finance로 POST하는 전송 부분만 고치는 거야.
