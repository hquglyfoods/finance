# Ugly Finance Tool - stop duplicate bot replies (Slack retries) + payroll amount

TWO issues from the last test:

1) The bot replied 2-3 times to one confirmation. Cause: our work (download 3 images +
   call Claude) takes a few seconds, so Slack thinks we failed and RETRIES the same
   event, running it again each time. Fix: both slack-payroll.js and slack-expense.js
   now detect Slack's retry header (x-slack-retry-num) and ignore retries, so one
   confirmation = one run = one reply. (The first, slow attempt still completes and
   posts once.)

2) The amounts were still wrong (FH showed $5,068.04 = Gross - tax). That is the OLD
   subtracting code. The current code does NOT subtract: payroll = Gross pay total as
   shown, payroll_tax = Employer taxes total. This means the previous test ran before
   this build was deployed.

HOW TO TELL THE NEW CODE IS LIVE after deploying:
- Correct (new): FH payroll = $5,534.88, BW = $7,194.54, AD = $8,738.04
- Old (subtracting): FH payroll = $5,068.04, BW = $6,593.05
Confirm the deploy shows Published in Netlify BEFORE re-testing.

Steps: deploy this, verify Published, reject the wrong pending rows in Approvals, then
re-confirm once in #payroll-corporate. You should get exactly ONE reply with the
Gross-pay numbers above.

No SQL this round.
