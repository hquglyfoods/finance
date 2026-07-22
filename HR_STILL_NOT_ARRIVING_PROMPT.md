# HR 앱 채팅에 붙여넣을 내용

아래 선 밑을 전부 복사해서 HR 앱(uglyhr) 채팅에 붙여넣으세요.

---

Submit to Finance 버튼 문제를 고치고 재배포한 뒤 payroll을 다시 전송했는데, **Finance 쪽에 여전히 아무것도 도착 안 해.** 이건 HR 전송 코드에 아직 문제가 있다는 뜻이야. Finance 쪽은 정상인 걸 확인했으니, HR 전송 부분을 다시 봐줘.

## Finance 쪽에서 확인된 사실 (Finance는 정상)

1. Finance webhook 함수(`payroll-ingest`)는 **살아있어.** 브라우저로 URL을 직접 열면 405 "POST only" 응답이 옴. 즉 함수는 배포돼 있고 POST를 기다리는 상태.
2. Finance Netlify 함수 로그를 확인했는데, HR이 전송했다는 시각에 **로그가 아예 안 찍혀.** `[payroll-ingest]` 로그가 하나도 없어. 요청이 Finance 서버에 도착조차 안 한 거야.
3. Finance DB에 `slack_ts LIKE 'hr_%'` 인 payroll 행이 **0개.** 데이터가 한 번도 안 들어왔어.
4. Finance Netlify에 `PAYROLL_INGEST_TOKEN` 설정됨. Finance webhook URL은 `https://uglyfinance.netlify.app/.netlify/functions/payroll-ingest` 로 정상 동작.

**결론: "로그에 아무것도 안 뜸" = HR이 요청을 실제로 안 보내고 있거나, 엉뚱한 곳으로 보내고 있음.** Finance 코드 문제가 아니라 HR 전송 문제야.

## HR 쪽에서 반드시 확인해줘

1. **전송 코드가 실제로 실행되는지.** Submit to Finance 버튼을 눌렀을 때 `fetch`(POST)가 진짜 호출되는지. 버튼 핸들러에 `console.log`를 넣어서, 클릭 시 (a) 핸들러가 실행되는지, (b) fetch가 호출되는지, (c) fetch가 어떤 응답/에러를 받는지 **브라우저 콘솔에 찍어줘.** 지금 이게 안 보여서 어디서 막히는지 모르는 상태야.

2. **URL을 어디서 읽는지.** `FINANCE_WEBHOOK_URL` 환경변수를 읽어서 그 값으로 POST하는지 확인. 이 앱이 순수 클라이언트(브라우저)에서 실행되는 React 앱이면, **브라우저 코드에서는 Netlify 환경변수(`process.env.FINANCE_WEBHOOK_URL`)를 못 읽어.** 빌드 스텝이 없는 CDN React 앱이면 `process.env`가 아예 없어서 URL이 `undefined`가 되고, fetch가 실패하거나 엉뚱한 데로 감. 이 경우:
   - URL과 토큰을 브라우저에 직접 두면 안 되니 (시크릿 노출), **HR 쪽에 프록시 Netlify function을 만들어야 해.** 브라우저는 HR 자신의 `/.netlify/functions/xxx` 를 호출하고, 그 function이 서버에서 `process.env.FINANCE_WEBHOOK_URL` 과 `process.env.PAYROLL_INGEST_TOKEN` 을 읽어서 Finance로 POST하는 구조. 이렇게 해야 환경변수도 읽히고 CORS/시크릿 문제도 없어.

3. **CORS.** 만약 브라우저에서 Finance로 직접 POST하고 있다면, 브라우저 콘솔에 CORS 에러가 있는지 봐줘. 크로스 도메인 POST는 CORS에 막히기 쉬워. (프록시 function으로 보내면 이 문제도 사라짐.)

4. **에러를 삼키는지.** try/catch로 잡고 아무 표시 안 하거나, `await` 없이 fire-and-forget이라 실패를 모르는 건 아닌지. 실패하면 화면과 콘솔에 명확히 남겨줘.

## Finance가 받는 정확한 형식 (이대로 보내야 함)

- **Method**: POST
- **URL**: `FINANCE_WEBHOOK_URL` = `https://uglyfinance.netlify.app/.netlify/functions/payroll-ingest`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Payroll-Token: <PAYROLL_INGEST_TOKEN 값>` (Finance와 정확히 같은 값)
- **Body**:
```json
{
  "period_end": "2026-07-19",
  "entries": [
    { "store": "AD", "payroll": 1234.56, "payroll_tax": 123.45 },
    { "store": "BW", "payroll": 1234.56, "payroll_tax": 123.45 },
    { "store": "FH", "payroll": 1234.56, "payroll_tax": 123.45 }
  ],
  "source_note": "HR app",
  "correction": false
}
```
- `period_end`: 주 마감 **일요일**, `YYYY-MM-DD`, **최근 60일 이내**여야 함 (오래되면 Finance가 400).
- `store`: 정확히 "AD"/"BW"/"FH". `payroll`/`payroll_tax`: 숫자 ("$"·콤마 없이).

## 가장 빠른 진단 방법

버튼을 누른 뒤 브라우저 콘솔에 이런 식으로 찍히게 해줘:
```
[submit-to-finance] clicked, url= ...   token set? true/false
[submit-to-finance] response status= 200  body= {...}
```
- url이 `undefined`로 나오면 → 환경변수를 못 읽는 것 (2번, 프록시 필요).
- fetch에서 CORS 에러 → 3번 (프록시 필요).
- status가 안 찍히고 에러만 → 요청이 아예 안 나가는 것.
- status 401 → 토큰 불일치.
- status 200인데 Finance엔 없음 → (이 경우는 아닐 것 같지만) URL이 다른 곳을 가리킴.

이 콘솔 출력이 나오면 그 내용을 그대로 알려줘. 그러면 어디서 막히는지 바로 확정돼.

## 하지 말 것

payroll 계산 로직은 건드리지 마. 전송(네트워크) 부분만.

## 참고: 테스트 주차

Finance엔 이미 7/5, 7/12 주 payroll이 들어가 있어서, 그 주를 보내면 "이미 있음"으로 스킵될 수 있어. **아직 안 들어간 최근 주(예: 7/13~7/19, period_end 2026-07-19)를 테스트로 보내야** Finance에 새로 꽂히는 걸 확인할 수 있어.
