# Ugly Finance Tool - semi-auto approvals

You approve new/unfamiliar things manually (which is what trains the system); once an
expense type is familiar it auto-approves.

EXPENSES (slack-expense.js):
- Auto-confirm ONLY when BOTH are true:
  1) Claude is confident about the reading, AND
  2) it's familiar - a past approval used the SAME category for a matching description
     (exact signal match, one contains the other, or 2+ shared distinctive words;
     common words like "from/store/cash" are ignored so they can't trigger a false
     auto-approval).
- Otherwise it stays PENDING for manual approval, exactly as before. Manual approvals
  keep teaching the system (they write the learning that later enables auto-approve).
- No amount cap: if it's familiar it auto-approves regardless of amount (as you chose).
- Auto-approved items are tagged in the memo "[auto-approved: matches a past approval]"
  and show with the Slack badge in the Daily view, where you can still edit or delete
  them.

PAYROLL (slack-payroll.js):
- Now books as CONFIRMED (not pending), since Chi already confirms it in Slack before
  you see it. The Slack reply wording changed to "Payroll booked... recorded in the
  finance app. Edit them there if anything looks off."

Also in this build (from the prior fix): Slack retry guard so one confirmation makes
one reply, and the corrected ADP reading (payroll = Gross pay total, payroll_tax =
Employer taxes total, no subtraction).

Behavior note: because familiar expenses skip Approvals now, the Approvals list will be
shorter - it only holds new/uncertain items. That is expected.

No SQL this round (uses existing slack_learnings, expenses.status).
