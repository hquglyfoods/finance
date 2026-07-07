# Ugly Finance Tool - manual & recurring expenses show even on board (Excel) days

You entered Lease, Loans, and Other Obligations manually on Jul 1, but Insights didn't
show them. Cause: Jul 1 also has the Excel "board" final import (Others, Supplies), and
the rule "a board day replaces non-board rows" was hiding ALL of them, including your
manual entries. That was too broad.

Fix: the board import now supersedes ONLY the auto-estimated sources it's meant to
replace - the Slack expense bot, Toast POS, and inventory sync. It no longer hides:
- manual entries (what you typed in Daily Entry),
- recurring bills,
- payroll (ADP bot).
These are never part of the Excel import, so they always count and always show, even on
a day that has board data.

Applied in all three places that use the rule: the P&L math (month/year/all-time), the
Daily day-by-day list, and Compare Stores. Verified on a Jul 1 with board Others/Supplies
+ manual Lease $25,000 + Loan $3,775 + a duplicate Slack line: the manual and board rows
all show and sum correctly, and only the duplicate Slack line is hidden.

Once deployed, your Jul 1 manual expenses (incl. Lease $25,000) will appear, and the Mall
Commission will recalculate correctly against the now-present Lease.

No SQL this round.
