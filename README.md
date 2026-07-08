# Ugly Finance Tool - mobile Insights fits on one screen

The Daily table needed constant left-right scrolling on a phone. This build makes it fit
the screen. Desktop is unchanged.

DAILY (mobile):
- The last-year amount columns are hidden by default; a small "{last year} amounts"
  toggle above the table brings them back when you want the actual dollar figures.
- Instead, every Sales and Expenses value carries a small always-visible delta under it
  (e.g. -30%), green/red. For expenses, lower than last year counts as green.
- The row itself is tightened (smaller type, tighter padding, whole-dollar display in the
  list - cents are hidden on the phone list only; all math and desktop stay 1-cent
  exact) and the expand arrow column is narrower. Result: the full row fits a 390px
  screen with no side-scrolling.
- Days with no sales yet this year now show LAST YEAR's sales faintly in the Sales
  column with a small 'YY marker (e.g. $9,936'25), so you can see at a glance how busy a
  coming day is likely to be. Mobile only; desktop already has the full column.

EXPANDED EXPENSE LINES (all screens):
- Long descriptions no longer blow up the column layout. Notes truncate with an ellipsis
  on one line; tap the note to expand the full text in place (tap again to collapse).

YEARLY (mobile):
- Monthly P&L: the Margin column tucks under Net as a small percentage, so that table
  fits too.

Verified on a 390px viewport: table width 361px vs 362px card (fits), deltas render,
toggle restores the last-year columns, ghost last-year sales show on empty days, memo
truncation + tap-to-expand works, totals row stays aligned. Desktop verified unchanged
(full columns, cents, no deltas, no toggle, no ghost).
