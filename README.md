# Ugly Finance Tool - history audit + UMMA fee + pickup edit

AUDIT (all months, not just June):
- With board-locked months, a FULL audit of every past month 2023-12..2026-06
  (174 months x 5 stores) matches the Excel board exactly: 0 sales, 0 expense
  mismatches. Any month that looked off was the same stray-row issue as June and is
  now correct.
- To SEE what stray rows existed in the DB: run audit_stray_sources.sql and
  audit_stray_expenses.sql (read-only).
- OPTIONAL: 25_cleanup_stray_past.sql deletes those leftover non-board rows in past
  months (the app already ignores them; this just tidies the DB). Does not touch
  July 2026+.

UMMA card fee (run 24_umma_card_fee.sql):
- The website payment company keeps 3% and deposits 97%. inventory-sync records the
  full invoice as revenue, so a 3% "Card Processing Fee" is now auto-booked as an
  expense each live month. Past (board) months already include the fee from Excel.

Cash pickup edit:
- Recent Pickups now has Edit and delete. Edit reloads the pickup into the form
  (jumps to its month), lets you change the period / re-count envelopes, and
  re-verifies. Delete un-verifies those days and removes the record.

SQL this round: 24_umma_card_fee.sql (required), 25_cleanup_stray_past.sql (optional).
