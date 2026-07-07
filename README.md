# Ugly Finance Tool - Toast tips backfill for a date range

Card tips are pulled from Toast by toast-sync, but it only syncs a rolling 3-day window,
so any older gap (e.g. Jul 1-6) never gets filled. Added a one-off backfill you can
trigger by URL:

  https://uglyfinance.netlify.app/.netlify/functions/toast-sync?start=2026-07-01&end=2026-07-06

- It re-pulls that exact inclusive date range from Toast for every store.
- By DEFAULT it books TIPS ONLY and does not touch revenue, so nothing you enter later
  (month-end totals / Excel board) gets overwritten.
- The response JSON lists each store/day with the tips amount it booked, so you can
  confirm.
- If you ever also want to refresh revenue for a range, add &tips_only=0.

Normal hourly sync is unchanged (no params = rolling 3-day window).

To fill the Jul 1-6 gap: deploy, then open the URL above once (adjust the year if
needed). From Jul 7 on, the regular sync handles it.
