# Ugly Finance Tool - investor monthly report: the big picture (part 1 of 2)

The investor Reports view now leads with a "big picture" block on the most recent
published month, built entirely from published data (nothing internal is exposed):

- 12-MONTH TREND chart: revenue as bars, net profit as a line, over the trailing
  published months. Calm, tap-for-values, investor-friendly styling.
- YEAR-OVER-YEAR: this month's revenue and net profit vs the same month last year, each
  with the prior figure and the % change.
- YEAR TO DATE: revenue, net, and margin for the current year through the latest
  published month.

Only the newest report shows this big-picture block; older months keep the clean
single-month statement, so scrolling back stays simple.

Verified with 14 published months: newest = July 2026, 12 trend bars, YoY "vs July 2025",
YTD 2026 = revenue $1,203,000 / net $173,000 / margin 14.4%.

Next (part 2): the Annual (year-end) closing + annual investor report. Coming in a
follow-up build.

No SQL this round (uses existing published monthly_close snapshots).
