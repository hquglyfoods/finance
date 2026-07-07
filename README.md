# Ugly Finance Tool - payroll books to the ADP pay-period end date

Payroll was booking to a server-computed "prior week Sunday" (6/28), which didn't match
the actual ADP work week. Now the bot reads the ADP "Payroll dates" range (e.g.
"Jun 29, 2026 -> Jul 5, 2026") and books to the END of that range (7/5), so payroll
lands on the Sunday that actually closes the work week it covers.

Details (slack-payroll.js):
- The image reader now also returns "period_end" (YYYY-MM-DD) from the ADP Payroll
  dates range.
- Each store books to its own period_end, validated (correct format, within ~60 days
  back / 14 days forward). If ADP didn't show a usable range, it falls back to the old
  prior-week-Sunday so nothing breaks.
- The Slack reply and push now show the real week-ending date(s), and each store line
  includes its week-ending date.

CLEANUP: the earlier run booked payroll to 2026-06-28 (wrong week). Delete those
6/28 payroll + payroll tax entries in the app (Daily view, June, the 28th). The
corrected run will book to 2026-07-05. Re-confirming creates new rows (different slack
timestamp), it does NOT overwrite the 6/28 ones, so remove the 6/28 ones manually.

Still included from prior builds: semi-auto approvals, Slack retry guard, correct ADP
column reading (Gross pay / Employer taxes).

No SQL this round.
