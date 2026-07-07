# Ugly Finance Tool - Slack photo/dedup/coin-change, new app icon, Annual report

Three areas in this build.

## 1) Slack expense capture (expense-* channels)
- PHOTO-ONLY posts are now recognized. A receipt photo with no text is processed
  (subtype handling relaxed; falls back to url_private when url_private_download is
  absent).
- DUPLICATE PROTECTION for "photo now, text a few minutes later" (either order): if a
  Slack expense with the EXACT same amount already exists for that store on the same
  local day, the second one is skipped.
- MESSAGE EDITS are caught: if an employee edits an earlier message (e.g. adds the amount
  they forgot, or corrects it), the existing expense is updated in place instead of a new
  one being created.
- COIN CHANGE is now booked as a cash expense (buying rolls of coins for the register).
  Because it legitimately repeats at the same amount several times a day, coin change is
  EXEMPT from the same-amount dedup. A coin box / cash COUNT report is still not an
  expense. Note: there's no dedicated "Coin Change" category yet, so it will file under
  the closest category (likely Others) until you add one in Settings.

## 2) New mobile app icon
Replaced icon-192, icon-512, and apple-touch-icon with the new navy/gold ledger icon,
and added favicon links. Installed PWAs may need to be removed and re-added for the OS to
refresh the home-screen icon.

## 3) Annual (year-end) report
- Close & Publish now has a Monthly / Annual toggle. Annual builds full-year figures from
  live ledger data; you can Preview, Save draft, Publish, and Unpublish (stored as
  month=0 in monthly_close).
- Investors see an "Annual Reports" section above the monthly ones, showing: full-year
  revenue / expenses / net / margin, vs last year (YoY), a by-quarter Q1-Q4 strip, and
  the 12-month revenue-and-net trend chart. All the big-picture context is live.

Verified: photo-only booked; same-amount second post deduped; edit updates in place;
coin change books and repeats; coin box report skipped; annual report shows 2025 totals,
Q1-Q4, vs 2024, and 12 monthly bars.

No SQL this round.
