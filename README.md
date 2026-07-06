# Ugly Finance Tool - recurring expense: Edit vs Schedule raise

Recurring Expenses (in Settings) now separates two actions:
- EDIT: fix the rule itself - name, category, amount, and especially the SCHEDULE
  (frequency / day of week / day of month). Use this when you picked the wrong
  frequency or day. It also has a Delete button. Changes apply going forward; past
  generated entries are kept.
- SCHEDULE RAISE: set a future amount/rate change on a date (e.g. a lease increase).
  The current amount runs until the effective date, then the new amount takes over.
  (This is the old "Change" button, renamed and clarified.)

Also:
- New recurring expenses default to Monthly, Day 1.
- The "Payee" field is renamed "Memo" everywhere in recurring (it was already being
  used as a memo).

No SQL this round.
