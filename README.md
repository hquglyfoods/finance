# Ugly Finance Tool - payroll bot: 48h screenshot window

Payroll is usually confirmed 24-36 hours after Maria posts the ADP screenshots, so the
6h (then 24h) lookback was too short and the bot found no screenshots to read.

Changes to netlify/functions/slack-payroll.js:
- Screenshot lookback widened to 48 hours (covers the 24-36h confirm gap with margin).
- Channel history fetch raised from 40 to 200 messages so a busy channel over 48h still
  includes the ADP screenshots (200 is Slack's max per call, no pagination needed).
- Image cap raised 12 -> 15 (3 stores of ADP plus any bonus/excel images that get
  ignored). The 15 kept are the most recent (closest to the confirmation).
- The diagnostic reply (how many images read, what was extracted, matchable store
  codes) from the previous build is still in place.

RE-TEST: confirm in #payroll-corporate. If the ADP screenshots are within 48h they'll
now be read. If it still can't book, the bot's reply will show what it extracted so we
can pinpoint store-identification vs code-matching.

No SQL this round.
