# UGLY FINANCE 인수인계 (새 채팅 시작용)

아래 내용 전체를 새 채팅 첫 메시지로 붙여넣고, **`ugly-finance-SOURCE+TOOLS.zip`을 함께 업로드**하세요.

---

## 0. 시작 지시

나는 John Kim, Ugly Donuts & Corn Dogs CEO다. "Ugly Finance" 앱 작업을 이어간다.

**첫 작업: 업로드한 `ugly-finance-SOURCE+TOOLS.zip`을 `/home/claude/finance/`에 풀고 이어서 작업할 것.**
컨테이너는 세션 간 초기화되므로 이 zip이 유일한 소스다.

```bash
mkdir -p /home/claude/finance
unzip -o /mnt/user-data/uploads/ugly-finance-SOURCE+TOOLS.zip -d /tmp/restore
cp -r /tmp/restore/ugly-finance/. /home/claude/finance/
ls /home/claude/finance
```

---

## 1. 대화 규칙 (반드시 지킬 것)

- **한국어로 대화** (요 체, 간결하게). 코드·UI·문서·주석은 전부 영어.
- **em dash( — ) 절대 사용 금지.** 쉼표, 마침표, 괄호, 콜론으로 대체.
- 아부/칭찬 금지. 직설적으로.
- **근본 원인 추적.** 증상만 덮지 말 것. 코드를 실제로 읽고, 실행해서 검증할 것.
- **범위 엄수.** 요청 안 한 것 건드리지 말 것.
- 재무 계산은 **1센트까지 정확**해야 함. 표시 반올림은 되지만 계산 반올림은 안 됨.
- 추측 금지. 확인 안 된 건 "확인 필요"라고 말하고 검증 방법을 제시할 것.

---

## 2. 앱 개요

**Ugly Finance**: 재무 관리 + 투자자 리포팅 PWA.

- 배포: https://uglyfinance.netlify.app
- 구조: **단일 `index.html`** React (Babel CDN, `<script type="text/app-jsx">`, 빌드 단계 없음)
- 백엔드: Supabase `https://zysfmeoopbtiselvdtnk.supabase.co`
  - 클라이언트 키(공개, 안전): `sb_publishable_yB8d3pf-ZqUiMiSKIGl69A_FZQgQbF1`
- 호스팅: Netlify + Netlify Functions
- 모바일 브레이크포인트: `@media(max-width:820px)`
- 작업 디렉토리: `/home/claude/finance/`

**법인 5개**: AD (American Dream), BW (Bushwick), FH (Forest Hills), HQ, UMMA
**역할 4개**: owner, assistant, investor, viewer(읽기 전용)

---

## 3. 납품 규칙 (모든 코드/SQL 변경 시 필수)

**present_files로 항상 두 개 다 전달:**

1. `/mnt/user-data/outputs/ugly-finance-repo.zip` — 배포용 (tools/, .env.example 제외), 최상위 폴더 `ugly-finance/`
2. `/mnt/user-data/outputs/ugly-finance-SOURCE+TOOLS.zip` — 전체 백업 (tools/, sql/ 포함). John이 영구 보관하고 다음 세션에 재업로드.

**SQL은 항상 별도 `.sql` 파일로도 전달.**

John이 직접 함: GitHub Desktop으로 배포, Supabase에서 SQL 실행.

### 빌드 명령

```bash
cd /home/claude/finance
rm -f /mnt/user-data/outputs/*.zip
rm -rf /tmp/src && mkdir -p /tmp/src/ugly-finance && cp -r /home/claude/finance/. /tmp/src/ugly-finance/
rm -rf /tmp/src/ugly-finance/node_modules /tmp/src/ugly-finance/.git
( cd /tmp/src && zip -rq "/mnt/user-data/outputs/ugly-finance-SOURCE+TOOLS.zip" ugly-finance )
rm -rf /tmp/dep && mkdir -p /tmp/dep/ugly-finance && cp -r /home/claude/finance/. /tmp/dep/ugly-finance/
rm -rf /tmp/dep/ugly-finance/node_modules /tmp/dep/ugly-finance/.git /tmp/dep/ugly-finance/tools /tmp/dep/ugly-finance/.env.example
( cd /tmp/dep && zip -rq /mnt/user-data/outputs/ugly-finance-repo.zip ugly-finance )
```

### 검증 (zip 만들기 전 매번)

```bash
# 1. Babel 변환
cd /tmp/babelcheck && node check.js          # 없으면 만들어야 함 (아래 참고)

# 2. CSS 중괄호 균형
cd /home/claude/finance
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const m=h.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)||[];let css=m.map(b=>b.replace(/<\/?style[^>]*>/gi,"")).join("\n");const o=(css.match(/{/g)||[]).length,c=(css.match(/}/g)||[]).length;console.log("CSS",o,c,o===c?"BALANCED":"MISMATCH");'

# 3. 앱 검증
NODE_PATH=/tmp/babelcheck/node_modules node tools/validate.js

# 4. 재무 회귀 테스트 (전부 통과해야 함)
for t in test_sum_expr test_dedup_window test_pl_math test_pl_edge test_rule_deps \
         test_board_lock test_board_payroll test_board_split test_invariants test_sql_parity; do
  printf "%-22s " "$t"; node tools/$t.js 2>&1 | tail -1
done

# 5. 서버리스 함수 문법
for f in netlify/functions/*.js sw.js; do node --check "$f" || echo "FAIL $f"; done
```

**babelcheck 환경 없으면 재생성:**
```bash
mkdir -p /tmp/babelcheck && cd /tmp/babelcheck
npm init -y >/dev/null 2>&1 && npm install @babel/standalone --silent
cat > check.js <<'EOF'
const fs=require('fs'), Babel=require('@babel/standalone');
const html=fs.readFileSync('/home/claude/finance/index.html','utf8');
const src=html.match(/<script type="text\/app-jsx">([\s\S]*?)<\/script>/)[1];
const out=Babel.transform(src,{presets:[['react',{runtime:'classic'}]]}).code;
console.log('BABEL TRANSFORM OK, output length:', out.length);
EOF
```

**렌더 테스트 (필요 시):** 컨테이너에서 Google Fonts/React CDN이 **차단**됨. React를 로컬 설치하고 `window.supabase.createClient`를 stub해서 Playwright로 테스트할 것. Playwright chromium 경로: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`

---

## 4. ★ 현재 진행 중인 최우선 작업 ★

### 문제: 앱 지출/매출이 엑셀과 안 맞음 (UMMA, HQ 확인됨. 전 매장 점검 필요)

John이 **전 매장 정밀 대차대조**를 요청했고, 감사 SQL(`sql/crosscheck_all.sql`)까지 만들어서 전달한 상태. **John이 실행 결과를 아직 안 줬음.**

**다음 단계: John에게 `crosscheck_all.sql` 실행 결과를 받아서 분석할 것.**

#### 앱이 엑셀과 어긋날 수 있는 경로는 딱 3가지 (코드 전수 확인 완료)

**(A) 엑셀 위에 덧붙여짐 → 앱이 더 큼**
엑셀 잠긴(board-locked) 달: `recurring`은 이제 slack/toast/inventory처럼 **제외됨** (2026-07 세션에서 수정. 엑셀에 임대료·공과금이 이미 있어 이중 계상되던 문제). `manual`, `cash_ledger`는 계속 더해짐.
- UMMA 5월 시뮬레이션: 엑셀만 = 9,323.31 (정확) → recurring 임대료/공과금 겹치면 15,529.31 (**+6,206 이중 계상**)
- **이게 가장 유력한 원인.** `crosscheck_all.sql` Block 2, 3, 7이 이걸 잡음.

**(B) 엑셀 import가 날짜를 빠뜨림 → 앱이 더 작음**
FH 6월 28일이 이 경우였음 (해결됨). Block 4가 잡음.

**(C) 카테고리/채널 연결 끊김 → 조용히 사라짐 → 앱이 더 작음**
Block 5가 잡음.

#### 감사 SQL의 신뢰성은 증명됨
`tools/test_sql_parity.js` — 감사 SQL의 계산 규칙이 앱의 `computePL`과 **1센트까지 동일**함을 6개 까다로운 케이스로 검증 완료. **SQL 결과 = 앱 화면 숫자.**

#### UMMA 기준값 (John이 준 엑셀, payroll 수정 반영됨)

| 월 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| TOTAL SALES | 3,434.50 | 3,234.61 | 4,004.22 | 3,579.35 | 4,853.00 | 6,340.00 |
| TOTAL EXPENSES | 19,587.65 | 8,860.00 | 8,770.09 | 16,154.08 | 9,323.31 | 13,885.10 |
| Lease | 6,006.00 | 6,006.00 | 6,006.00 | 6,006.00 | 6,006.00 | 6,006.00 |
| Utilities | 200.00 | 200.00 | 200.00 | 200.00 | 200.00 | 200.00 |
| Payroll | 1,900.00 | 1,800.00 | 1,700.00 | 2,500.00 | 1,500.00 | 2,500.00 |
| Supplies (Food) | 10,363.00 | - | - | - | - | 1,955.34 |
| Shipping & Processing | 768.61 | 522.96 | 522.96 | 7,015.70 | 1,276.72 | 2,708.56 |
| Other Obligations | 350.04 | 331.04 | 341.13 | 432.38 | 340.59 | 515.20 |

엑셀 내부 정합성 검증 완료 (6개월 모두 항목 합 = 총액).
**UMMA 카테고리는 전부 존재함** (Shipping 포함). 카테고리 누락은 원인 아님.

#### UMMA 매출 DB 실제 상태 (확인됨)

| 날짜 | 채널 | 금액 | source |
|---|---|---|---|
| 2026-07-07 | ugly | 0 | inventory |
| 2026-07-06 | ugly | 198 | inventory |
| 2026-06-30 | ugly | 220 | inventory |
| 2026-06-29 | ugly | 1100 | inventory |
| 2026-06-28 | ugly | 308 | inventory |
| 2026-06-27 | ugly | 726 | inventory |
| 2026-05-31 | ugly | 4853.00 | manual |
| 2026-04-30 | ugly | 3579.35 | board |

- **5월 (4,853)**: 코드 버그로 앱에서 0으로 표시됐음 → **이미 수정함** (§5 참고). 배포하면 복구됨.
- **6월**: DB에 2,354만 있음 (inventory, 6/27~30). 엑셀은 6,340. **3,986 누락.**
  → `sql/umma_june_fix.sql` 실행 필요 (아직 John이 안 함)
  → 원인: 5월까지는 월말 수동 입력, 6월 27일부터 inventory 자동 연동 시작. 6/1~26이 빈 구멍.
- 7월 7일에 **0원짜리 매출 행** 있음 (노이즈, 삭제 권장)
- **주의**: 이제 inventory 연동이 UMMA 매출을 자동 생성함. 예전처럼 월말 수동 입력하면 **이중 계상됨.**

#### UMMA 채널 설정 (확인됨, 문제 없음)
`ugly`(active), `franchise`(inactive), `other_rev`(inactive), `other_income`(active) — 전부 `counts_in_total=true`.
**앱은 채널 로드 시 active 필터를 안 걸므로 비활성 채널 매출도 정상 합산됨.** 검증 완료. 원인 아님.

#### 참고
- John이 앱에서 **UMMA payroll 금액만 1~6월 수정**함. 나머지는 안 건드림.
- HQ도 매출·지출이 엑셀과 다름. 아직 원인 미확인.

---

## 5. 이번 세션에서 고친 것 (전부 코드에 반영됨, 배포 필요)

### 재무 계산 버그 (중요)

**1. board-lock이 매출/지출을 뭉뚱그려 판단 → 매출이 0으로 사라짐** ★
- 증상: UMMA 5월 매출 4,853이 앱에서 0
- 원인: `boardLocked`가 **지출**에 board 행이 있으면 켜지고, 그 상태에서 board가 아닌 **매출**을 전부 버림
- 수정: `revLocked`(매출에 board 있을 때만) / `expLocked`(지출에 board 있을 때만)로 **분리**. 자동 규칙 차단(`boardLocked`)은 기존대로 둘 중 하나라도 있으면 켜짐.
- 위치: `computePL` (~line 1267)
- 테스트: `tools/test_board_split.js` (6개)
- **영향 범위: UMMA만이 아님. 매출과 지출을 다른 방식으로 입력한 모든 달.**

**2. 급여 이중 계상 (FH 6월)**
- 엑셀에 급여가 있는데 payroll_bot(ADP)이 그 위에 또 더해짐
- 수정: `isBoardSuperseded(e, catCode, boardHasPayroll)` — 엑셀에 급여가 **실제로 있을 때만** payroll_bot(급여+급여세) 억제. 엑셀에 급여 없는 매장은 ADP 값 유지.
- 테스트: `tools/test_board_payroll.js` (9개, 실제 FH 데이터로 검증)

**3. 규칙 간 의존성 순서**
- royalty가 sales_tax를 참조하는데 display_order대로 평가해서 sales_tax를 0으로 취급
- 수정: 의존성 순서로 평가 (dependency resolution)
- 테스트: `tools/test_rule_deps.js`

### FH 6월 지출 (완료, 검증됨)
- 실제 비용 **52,496.98**
- 원인 2개가 상쇄되며 숨어있었음:
  - 엑셀 import가 **6월 28일 통째로 누락** (payroll 3,913.20 + supplies 884.50 = 4,797.70) → John이 SQL로 복구 완료
  - payroll_bot 급여 **+6,001.72 이중 계상** → 코드 수정 완료
- 차이 검산: +6,001.72 − 4,797.70 = +1,204.02 (앱이 53,701.00으로 과다 계상했던 것) ✓ 완전 설명됨
- **다른 달·매장은 import 날짜 누락 없음 확인됨**

### 계정 관리 (완료)
- **ID 로그인**: 이메일 없이 ID로 계정 생성/로그인 가능. 내부적으로 `<id>@id.uglydonutsncorndogs.com`으로 변환 (사용자에겐 안 보임).
  - **주의**: 처음에 `.local` 도메인을 썼는데 Supabase가 예약 TLD라 거부함. 실제 도메인으로 교체함. 구 도메인 하위 호환 있음.
- **"Invalid token" 버그**: 원인은 **죽은 세션**(`session_not_found`). 토큰은 유효하지만 서버에 세션 기록이 없어서 관리자 작업이 403.
  - 수정: `authHeaders()`가 호출 직전에 세션이 살아있는지 확인 → 죽었으면 자동 갱신 → 안 되면 로그아웃 + 명확한 안내
  - 또한 `create-account.js`의 인증을 SDK(`auth.getUser`)에서 **REST 직접 호출**로 교체 (`sb_secret_` 키와 SDK 호환 문제)
  - 에러 메시지에 진단 정보 포함 (HTTP status, Supabase 응답 원문)

### UI/UX (완료)
- **매장 선택이 탭 간 유지됨** (`useCorpSelection` 훅). Entry에서 HQ 고르고 Insights 가도 HQ 유지. localStorage에 저장돼 새로고침해도 유지. 9개 컴포넌트 전부 적용.
- **Home 날짜 이동**: ‹ / › 로 하루씩, Today 버튼으로 복귀. 미래 차단. 카드/팝업 문구도 선택 날짜 반영.
- **리포트 접힘 + 팝업**: 요약 카드(월/Sales/Expenses/Net+마진) → 탭하면 전체 statement 팝업.
- **리포트 차트 스냅샷**: 발행 시점에 12개월 트렌드 + YoY를 `summary.trend` / `summary.last_year`에 저장. 투자자는 원본 테이블 접근 없이 그 사본을 렌더. **RLS 문제 없고 재계산 없음.**
  - ⚠️ **기존에 발행된 리포트에는 스냅샷이 없음. 각 월을 다시 Publish 해야 차트가 들어감.**
- **YoY 블록**: "Compared to [월] [작년]" + 각 %에 "this year" 표기 (방향 혼동 방지)
- **Unpublish 버튼**: Reports 탭에서 오너만. 클릭해도 팝업 안 열림.
- **Reports 탭**: owner + investor + viewer 전부 접근
- **하단 바**: 탭 4개 이하 역할은 전부 표시 (viewer = Home/Insights/Reports/⋮). investor는 탭 1개라 하단 바 숨기고 ⋮를 우측 상단으로.
- **Cost Ratios 차트 Y축**: 5% 고정 눈금 → 데이터 범위에 맞춰 자동 (5/10/25/50/100%...). UMMA가 301% 나와서 눈금 61줄이 겹쳤던 것 해결. 항상 6~8줄 유지.
- **KPI 팝오버**: `var(--card)` 변수가 **존재하지 않아서** 글자가 안 보였음 → `var(--panel)`로 수정 (3곳). 바깥 클릭 시 닫힘 추가.
- **버튼 색**: 전역 `button{}`에 `color` 없어서 iOS Safari가 링크 파란색 적용 → `color:var(--text)` 추가
- Accounts 탭 버튼 한 줄 정렬, 모바일 넘침 방지

### 보안 (감사 완료)
- 서버리스 함수 13개 전수 점검. **무방비 엔드포인트 0개.** 전부 owner 인증 / webhook secret / Slack 서명 / 스케줄 전용으로 보호됨.
- `toast-payout-diag.js`에 인증 없던 것 발견해서 owner-gate 추가함.
- Viewer RLS: `is_viewer() AND can_view_corp()`로 게이트 (investor도 can_view를 갖기 때문에 can_view만으로 게이트하면 investor에게 원본 데이터 노출됨. 반드시 이 조합 유지.)

### 전수 디버깅 (완료, 버그 없음)
4개 역할 × 전 탭 × 모바일/데스크톱 = 44개 화면 조합에서 런타임 에러 / 콘솔 에러 / 무한 로딩 / 빈 화면 / 가로 스크롤 **전부 0건**.

---

## 6. 아직 John이 안 한 것 (액션 필요)

1. **`ugly-finance-repo.zip` 배포** ← 위 코드 수정 전부 여기 들어있음
2. **`sql/umma_june_fix.sql` 실행** ← UMMA 6월 매출 3,986 누락분 채우기
3. **`sql/crosscheck_all.sql` 실행 후 결과 공유** ← ★ 최우선. 전 매장 대차대조
4. **각 월 리포트 재발행** ← 차트 스냅샷 저장 + 수정된 숫자 반영
5. UMMA 7/7 0원 매출 행 삭제 (선택)

---

## 7. 핵심 코드 위치 (index.html, ~5790줄)

| 항목 | 위치 |
|---|---|
| `useCorpSelection` (탭 간 매장 유지) | ~980 |
| ID 로그인 헬퍼 (`toAuthEmail`, `displayLogin`) | ~1000 |
| `loadCorpMeta` | ~1105 |
| `AUTO_SOURCES`, `isBoardSuperseded` | ~1122 |
| **`computePL`** (재무 계산 핵심) | ~1260-1340 |
| `buildSummary` (리포트 스냅샷 저장) | ~1385 |
| `TrendChart` | ~1500 |
| `RatioChart` (Y축 자동 눈금) | ~1540 |
| `Dashboard` (Insights) | ~1610 |
| `Entry` | ~2640 |
| `CashPage` | ~3210 |
| `Recurring` | ~3545 |
| `ClosePage` (Close & Publish) | ~3960 |
| `fnError`, `authHeaders` | ~4418 |
| `Admin` (Accounts) | ~4440 |
| `loadTrend12` | ~4151 |
| `StatementView` | ~4180 |
| `InvestorPortal` (Reports) | ~4290 |
| `Settings` | ~5185 |
| `Login` | ~5500 |
| 앱 shell / 네비게이션 | ~5600-5700 |

**Netlify Functions**: `create-account.js`(생성/삭제/비번재설정, REST 인증), `push-notify.js`, `toast-sync.js`, `recurring-cron.js`, `slack-events.js` / `slack-expense.js` / `slack-payroll.js`, `inventory-sync.js`, `daily-sales-report.js`, `toast-diag.js`, `toast-payout-diag.js`, `push-test.js`

**환경변수 (Netlify)**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`(sb_secret_...), `RESEND_API_KEY`, `HQ_NOTIFY_EMAILS`, `VAPID_PRIVATE_KEY`, `ALLOWED_ORIGIN`, `WEBHOOK_SECRET`

---

## 8. 재무 규칙 (활성)

- **AD**: cc_fee=(ch_card+ch_online+cat_tips)*0.03 / sales_tax=(total_sales-cat_tips-ch_uber-ch_grubhub-ch_doordash)*0.06625 / royalty=(total_sales-cat_tips-sales_tax)*royalty_rate / mall_commission=max(0,total_sales*0.15-cat_lease) / marketing=(total_sales-cat_tips-sales_tax)*marketing_rate / other_obligations=cat_payroll*0.13 / delivery_commission=3PO*0.30 / delivery_sales_tax=3PO*0.06625
- **BW/FH**: sales_tax=(ch_cash+ch_card+ch_online)*0.08875 / delivery_sales_tax=3PO*0.08875 / royalty·marketing·other_obligations·cc_fee·delivery_commission는 AD와 동일
- **HQ/UMMA**: other_obligations=cat_payroll*0.13 / UMMA processing_fee=ch_ugly*0.03
- royalty 기본 0.03, marketing 0. `payroll_tax` 규칙은 **비활성**(앱은 active=true만 가져옴).
- **board-locked 달에는 자동 규칙 전부 꺼짐** (엑셀이 최종본)

---

## 9. 핵심 교훈 (반복하지 말 것)

- `--card` CSS 변수는 **존재하지 않음**. 흰색은 `--panel`, 오프화이트는 `--panel2`/`--panel3`.
- 버튼에 `color` 명시 안 하면 iOS Safari가 링크 파란색 적용.
- **RLS가 진짜 보안 경계.** viewer 읽기는 `is_viewer() AND can_view_corp()`로. `can_view_corp()`만으로 하면 **investor에게 원본 데이터가 노출됨.**
- 규칙 간 참조는 **display order가 아니라 의존성 순서**로 평가.
- board-lock은 **매출/지출 독립적으로** 판단. 한쪽 board 행이 다른 쪽을 잠그면 안 됨.
- 엑셀 잠긴 달: `recurring`은 제외됨 (AUTO_SOURCES에 포함, 2026-07 수정). `manual`/`cash_ledger`는 계속 더해짐 → 잠긴 달에 manual 입력하면 엑셀 위에 더해지니 주의.
- 리포트 차트는 **발행 시점 스냅샷**. 투자자는 원본 테이블 접근 불가.
- useEffect 안에 정의한 헬퍼는 형제 핸들러에서 안 보임 (인라인할 것).
- 컨테이너에서 Google Fonts / React CDN **차단됨**. 렌더 테스트는 React 로컬 설치 + supabase stub.
- Supabase는 `.local` 같은 예약 TLD를 유효한 이메일로 인정 안 함.
- `sb_secret_` 키는 supabase-js SDK의 `auth.getUser(token)`과 호환 문제 있음. **REST 직접 호출** 사용.
- Supabase 액세스 토큰은 1시간 만료. React state에 담아둔 세션은 낡을 수 있음 → 호출 직전 `getSession()`.

---

## 10. tools/ 테스트 목록 (전부 통과해야 함)

| 파일 | 내용 |
|---|---|
| `extract_core.js` | index.html에서 순수 함수 추출 (다른 테스트가 사용) |
| `validate.js` | 앱 전체 검증 |
| `test_pl_math.js` | P&L 계산 (16) |
| `test_pl_edge.js` | 엣지 케이스 (18) |
| `test_rule_deps.js` | 규칙 의존성 순서 (10) |
| `test_board_lock.js` | board-lock 동작 (4) |
| `test_board_payroll.js` | 급여 이중계상, 실제 FH 데이터 (9) |
| `test_board_split.js` | **매출/지출 잠금 분리 (6)** ← 이번 세션 |
| `test_invariants.js` | 재무 불변식 (9) |
| `test_sql_parity.js` | **감사 SQL = 앱 계산 일치 증명 (6)** ← 이번 세션 |
| `test_sum_expr.js`, `test_dedup_window.js` | 수식/중복 |
| `diagnose_token.js` | 브라우저 콘솔용 토큰 진단 |

## 11. sql/ 주요 파일

| 파일 | 내용 |
|---|---|
| **`crosscheck_all.sql`** | ★ **전 매장·전 월 대차대조 감사 (7블록). 최우선 실행 대상.** |
| `umma_june_fix.sql` | UMMA 6월 매출 3,986 누락분 복구 |
| `fh_june_missing_day.sql` | FH 6/28 누락 (완료됨) |
| `viewer_read_access.sql` | viewer RLS (적용됨) |
| `viewer_role_constraint.sql` | profiles role에 viewer 허용 (적용됨) |
| `full_audit.sql`, `expense_audit.sql` | 이전 감사들 |
