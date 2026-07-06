# Ugly Finance Tool - card alignment + buttons look like buttons

- Home store cards: the name is now a fixed 2-line height (smaller font, clamped to
  2 lines), so a 1-line name like "Ugly HQ" reserves the same space as a 3-line name
  like "Ugly AD (American Dream)". Everything below (revenue/expenses, progress,
  Enter button) lines up at the same height across all cards. Verified: all names
  40px tall, Enter buttons aligned per row.
- Buttons now read as buttons everywhere: clearer panel background, rounded corners,
  a subtle shadow, cursor pointer, and hover lift. Applies to .btn, the Home "Enter"
  button, and the tabs.
- Cash "Record Envelope Pickup" card: the header now has a gold-tinted background and
  a round chevron so it clearly looks tappable, not like plain text.
