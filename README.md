# Ugly Finance Tool - Insights restructured: period vs. store-compare are now separate

Cleaner layout, especially on mobile. "When" (period) and "what" (single store vs.
store comparison) are now independent controls instead of both living in the tab bar.

- Top period tabs are now just: Daily / Month / Year / All-Time (was six tabs).
- 3-Year moved INTO Year: the Year view has a 1 Year / 3 Years switch. "3 Years" shows
  the multi-year "Sales by Month" comparison chart.
- Compare Stores is now a toggle button next to the store tabs ("Compare stores").
  Turn it on and the current period (Daily/Month/Year/All-Time) is compared across up
  to 3 stores. Turn it off to go back to a single store.
- Because period and compare are independent, you can now do things like Compare +
  Daily to compare a specific date (July 4th, a snow day) across stores, or Compare +
  Year for full-year store-vs-store.
- The redundant in-panel period tabs inside Compare Stores were removed (the period is
  driven by the shared top tabs now).

Verified: top tabs = 4; Year has 1y/3y with the 3-year chart; Compare toggle switches
in/out; Compare + Daily shows a date picker and per-day store comparison. No errors.

No SQL this round.
