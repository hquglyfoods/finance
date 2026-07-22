-- ============================================================================
-- HR payroll이 Finance에 저장돼도 화면에 안 보일 수 있는 두 가지를 진단.
-- (HR 재배포 후 전송이 시작되면, DB엔 들어오는데 화면엔 왜 안 뜨는지 미리 확인.)
-- 모두 read-only.
-- ============================================================================

-- ---------- CHECK 1: payroll / payroll_tax 카테고리 active 상태 ----------
-- payroll_tax가 inactive(active=false)면, 수동 입력 드롭다운 등 active로 거르는
-- 화면에서 안 보여. (단, computePL P&L 표시는 "금액 있으면 표시"라 총계엔 나옴.)
SELECT co.code AS store, ec.code AS category, ec.name, ec.active, ec.display_order
FROM public.expense_categories ec
JOIN public.corporations co ON co.id = ec.corporation_id
WHERE co.code IN ('AD','BW','FH') AND ec.code IN ('payroll','payroll_tax')
ORDER BY co.code, ec.code;


-- ---------- CHECK 2: 최근 달에 board(Excel) payroll이 있나? ----------
-- 있으면 computePL이 payroll_bot(HR/Slack) 행을 이중계상 방지로 화면 총계에서 제외해.
-- 즉 HR payroll이 DB엔 있어도 그 달 화면엔 안 보임. (board가 이미 payroll을 들고 있으니)
-- store별, 월별로 board payroll 존재 여부를 보여줌.
SELECT co.code AS store,
       to_char(date_trunc('month', e.date), 'YYYY-MM') AS month,
       bool_or(e.source='board' AND ec.code IN ('payroll','payroll_tax')) AS board_has_payroll,
       count(*) FILTER (WHERE e.source='board' AND ec.code IN ('payroll','payroll_tax')) AS board_payroll_rows,
       count(*) FILTER (WHERE e.source='payroll_bot' AND ec.code IN ('payroll','payroll_tax')) AS bot_payroll_rows
FROM public.expenses e
JOIN public.corporations co ON co.id = e.corporation_id
JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE co.code IN ('AD','BW','FH')
  AND ec.code IN ('payroll','payroll_tax')
  AND e.date >= date_trunc('month', CURRENT_DATE) - INTERVAL '2 months'
GROUP BY co.code, date_trunc('month', e.date)
ORDER BY co.code, month;
-- board_has_payroll = true 인 (store, month)에서는 payroll_bot 행이 화면 총계에서 빠짐.
-- 그 달에 HR payroll을 화면에 보이게 하려면: 그 달이 board-locked인지, board가 실제로
-- payroll을 들고 있는지 확인하고, 이중계상이 아닌 게 확실하면 처리 방법을 판단.


-- ---------- CHECK 3: 그 달이 board-locked(확정) 상태인가? ----------
SELECT co.code AS store, mc.year, mc.month, mc.status
FROM public.monthly_close mc
JOIN public.corporations co ON co.id = mc.corporation_id
WHERE co.code IN ('AD','BW','FH')
  AND (mc.year, mc.month) >= (EXTRACT(year FROM CURRENT_DATE)::int, EXTRACT(month FROM CURRENT_DATE)::int - 2)
ORDER BY co.code, mc.year, mc.month;
