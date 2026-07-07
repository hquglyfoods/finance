# Ugly Finance Tool - edit/delete approved expenses from Insights Daily

In Insights -> Daily, open a day with the arrow (v). Every expense line that came from
Slack or manual entry now has:
- Edit: inline form to fix the category, amount, date, or memo. Save updates the
  expense and the view refreshes.
- X (delete): removes the expense after a confirmation.

Rules:
- Owner only.
- Board-imported lines (historical snapshot) are protected - no Edit/X on those.
- The day totals, month KPIs, and everything downstream recompute automatically after
  a change.

Also in this build (from the previous rounds, deploy if you have not yet):
- Home cards: identical heights in every case; pending moved to a top-right pill badge.
- inventory-sync: today's UMMA orders and HQ QuickBooks invoices sync the same day,
  plus a diagnostic JSON response (sourcesSeen / ummaRevenueByChannel).
- Web push: key loader fix, push-test diagnostics, webhook hardening + logging.

No SQL this round.
