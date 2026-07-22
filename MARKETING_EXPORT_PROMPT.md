# Prompt to paste into the Ugly Finance app chat

Copy everything below the line into the Finance app's chat.

---

Ugly Marketing 앱으로 과거 매출 히스토리를 넘기려고 해. Finance DB에서 일별 매출을 CSV로 뽑는 SQL을 만들어줘.

## 배경

별도로 만든 Ugly Marketing 앱(Toast POS 데이터 분석용, 다른 Supabase 프로젝트)이 있어. 이 앱은 Toast를 쓰기 시작한 2025-07-01부터의 데이터만 있어. 그 이전 Excel 시절 매출 흐름을 AI가 계절성/장기 트렌드 분석에 쓸 수 있게, Finance 앱에 있는 Toast 이전 일별 매출을 CSV로 뽑아서 Marketing 앱에 한 번 import 하려고 해.

## 필요한 것

`daily_revenue` 테이블에서 매장별·날짜별 총 매출을 뽑는 SELECT SQL. Supabase SQL Editor에서 실행하고 결과를 CSV로 다운로드할 거야.

## 정확한 출력 형식 (Marketing 앱이 이 형식을 기대함)

- 컬럼 3개, 헤더 정확히 이 이름: `store`, `date`, `revenue`
- `store`: AD, BW, FH 중 하나 (corporations 코드 그대로. HQ, UMMA, Pearland는 제외)
- `date`: YYYY-MM-DD 형식
- `revenue`: 그 매장 그 날의 총 매출 (숫자, 소수점 2자리)
- 하루에 매장당 한 줄

## 매출 계산은 반드시 computePL과 똑같이 (중요)

단순 `SUM(amount)`로 뽑으면 안 돼. 우리 앱이 매출을 인정하는 규칙을 그대로 적용해줘. 이게 이 작업의 핵심이야. 구체적으로:

- **`revenue_channels.counts_in_total = true`인 채널만** 합산해. memo용이나 total에 안 들어가는 채널은 제외.
- **각 금액에 그 채널의 `total_multiplier`를 곱해서** 합산해. 예를 들어 배달앱 채널이 0.7 같은 배수를 가지면 그걸 반영해야 실제 인정 매출이 나와. 단순 합이 아니라 `SUM(amount * total_multiplier)`.
- 그 날 그 매장의 **모든 해당 채널을 합쳐서 한 줄**로.
- board-locked(Excel로 확정된) 월이든 아니든, 그 날의 실제 인정 매출 총액이면 돼. 혹시 확정 월에서 recurring/중복 소스를 억제하는 로직이 매출 쪽에도 있으면 그것도 computePL과 동일하게 반영해줘. (매출은 보통 억제 대상이 아니지만, computePL이 실제로 쓰는 규칙 기준으로 맞춰줘.)

정리하면: 이 CSV의 각 revenue 값이 그 날 그 매장의 Home 화면 "오늘 매출" 및 P&L의 Sales와 일치해야 해. computePL이 최종 인정하는 매출과 1:1로 맞아야 돼.

## 기간

- 데이터가 있는 가장 이른 날짜부터 **2025-06-30까지만.**
- 2025-07-01 이후는 Marketing 앱이 Toast로 이미 갖고 있어서 중복이니까 제외.

## 실행 전에 확인해줘

1. 먼저 **어떤 테이블·컬럼에서 일별 매출을 읽는지**, 그리고 채널 multiplier와 counts_in_total을 어떻게 반영했는지 설명해줘.
2. 그 다음 **미리보기**로 처음 20줄 정도 샘플을 보여줘서 형식(store/date/revenue 헤더, 값)이 맞는지 확인할 수 있게 해줘.
3. 내가 미리보기 확인하면 전체를 뽑는 최종 SQL을 줘.
4. 혹시 2025-07-01 이전 기간에 채널 구조나 multiplier가 지금과 달랐던 적이 있으면 (예전 채널이 사라졌거나 배수가 바뀌었거나) 알려줘. 그러면 그 시기 매출이 지금 규칙으로 계산해도 맞는지 같이 판단하자.

이 SQL 결과를 CSV로 받아서 Marketing 앱 Admin의 "Pre-Toast history" import에 넣을 거야.
