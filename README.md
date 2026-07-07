# Ugly Finance Tool - Daily "What stands out" insights (rule-based)

Adds a small insights card under the three KPI cards on the Daily view. It's rule-based
(no AI, no extra queries), computed from the month's daily rows, and only shows lines
that actually apply:

- Best / slowest sales day of the month (with the day and amount).
- Days that ran at a loss (count + which days).
- A cost anomaly: a single expense line that is >= $500 AND at least 2x that category's
  typical daily line, flagged with the day. (Regular fixed costs like rent that are
  similar every month do NOT trip this, by design.)
- Month-end projection (only mid-current-month): projected sales and net if the current
  pace holds.

The card hides itself entirely when nothing notable applies.

Also in this build: Daily KPI cards now compare the same period to date vs last year
(through today's day-of-month), and the "vs last year vs 2025" duplicate label is fixed.

No SQL this round.
