# Ugly Finance Tool - installments

Run 29_installments.sql first.

- New "New Installment" section under Recurring Expenses (in Settings): for anything
  paid over a fixed number of months, like equipment split into 3 payments.
- You enter: name, category, amount per month, number of months, the day it charges,
  and the start date. It shows the total (amount x months) before you add.
- It runs monthly and STOPS automatically after the last payment (the end date is
  computed for you). The recurring cron already respects the end date, so no extra
  step is needed.
- In the list, installments show an "Installment" badge and "N payments - ends DATE".

SQL this round: 29_installments.sql (required).
