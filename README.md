# Ugly Finance Tool - full mobile pass complete

This build finishes all 7 mobile items plus the data/logic fixes.

MOBILE (1-7):
1. Bottom nav: bigger icons; "More" is a vertical (⋮) with no label; bar raised off
   the screen edge.
2. Home store cards open that store's SALES DETAIL (Insights daily). A small
   "+ Enter today's numbers" button still goes to entry. 2 cards per row, compact.
3. Account menu (avatar + ⋮) with name/role, Notifications, enable push, Sign Out.
   A notification BELL sits next to it with an unread badge and a feed panel.
4. Insights: Daily and Year keep 3 compact KPI cards in one row on mobile (no ugly
   2+1 wrap). Each period shows only its own cards.
5. Cash: "Record Envelope Pickup" moved ABOVE the calendar, collapsed by default.
   Expand -> per-day envelope list with expected (cash sales - cash spent); enter
   the actual counted amount per envelope; per-day + total differences shown.
6. Investor reports redesigned as a professional monthly statement (store header,
   summary band, revenue/expense columns, net line, attachments).
7. Settings sub-tabs scroll horizontally instead of squishing; content fits phone.

DATA / LOGIC:
- Per-date board precedence (board days win per date; live days show normally).
- 1000-row cap fixed everywhere (Year / 3-Year / All-Time / trend / home).
- Expense entry: editable date + Card/Cash/Transfer method.
- Cash calendar: red marker on cash-expense days + expected envelope.
- Recurring: schedule a future amount change (lease raises).
- inventory-sync: ?from=&to= backfill for UMMA orders.

SQL (run in order if not already):
  19_expense_method.sql, 20_july_1_5.sql, 21_notifications.sql,
  22_recurring_schedule.sql
