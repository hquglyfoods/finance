# Ugly Finance Tool - payroll no longer hidden by board data + board rows are editable

This explains why payroll "didn't show up": it WAS saved (on 6/28), but the app hides
non-board expenses on any day that also has Excel board data. Payroll is never in the
Excel import, so it was being hidden and left out of the totals.

Two fixes:

1) Payroll_bot expenses are now EXEMPT from the "board hides non-board" rule everywhere:
   - computePL (month / year / all-time P&L math),
   - the Daily view day-by-day list,
   - loadDayPL (Compare Stores).
   So payroll always shows and always counts, even on days with board data. Verified:
   a day with $1,200 board + $8,738.04 payroll now totals $9,938.04 and both lines
   appear.

2) Daily view Edit / ✕ buttons now appear for BOARD (Excel) rows too, not just
   slack/manual ones, so you can correct or remove imported lines. (Still owner-only.)

So your existing payroll on 6/28 should now be visible in June with the correct totals.
If you re-book it to 7/5 (date fix) you can delete the 6/28 copy from the Daily view now
that board/any row is deletable.

Note: buttons only show for role = owner. If you still don't see them, your account
role may not be "owner".

Includes prior fixes: payroll saves row-by-row (no silent duplicate block) and reports
the real saved count; payroll date = ADP period end; semi-auto approvals; retry guard;
Insights speed + auto-refresh.

No SQL this round.
