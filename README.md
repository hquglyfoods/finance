# Ugly Finance Tool - cash calendar cells are a uniform size

The Cash Calendar day cells were sized by content (min-height), so a day with more info
(sales + cash spent + envelope + counted) grew taller than its neighbors and the grid
looked uneven. Now every cell is a fixed height sized for the busiest possible day, so
the calendar is even no matter what a day contains:
- Desktop: 96px cells (grid-auto-rows + fixed height).
- Mobile: 88px cells.
- overflow:hidden guards against any rare extra line.

Verified: all cells identical height on mobile (88) and desktop (96), including the
fullest day (sales + cash expense + envelope + counted), with no content clipped.

No SQL this round.
