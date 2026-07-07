# Ugly Finance Tool - Slack events router (payroll confirmations now reach the app)

WHY: A Slack app has only ONE Event Subscriptions request URL, but we have two
handlers - slack-expense (expense-* channels) and slack-payroll (#payroll-corporate).
Only whichever one the URL pointed at was receiving events, so Chi's "payroll looks
good" never reached slack-payroll and nothing showed up in the app.

FIX: new netlify/functions/slack-events.js is a single entry point that answers the
URL-verification handshake and dispatches each event by channel:
  - PAYROLL_CHANNEL_ID           -> slack-payroll
  - channels in SLACK_CHANNEL_MAP -> slack-expense
  - anything else                -> ignored
Each underlying handler still does its own signature check and idempotency; the router
only decides which one to call.

ACTION REQUIRED (Slack app settings, api.slack.com/apps -> Event Subscriptions):
1) Set the Request URL to:
   https://uglyfinance.netlify.app/.netlify/functions/slack-events
   (wait for it to verify - the handshake is handled).
2) Keep BOTH bot events subscribed: message.channels AND message.groups
   (expense-* and payroll-corporate are private channels; groups covers private).
3) Make sure the bot is a member of #payroll-corporate (/invite the app).
4) Confirm env vars exist: PAYROLL_CHANNEL_ID (the #payroll-corporate channel id),
   SLACK_CHANNEL_MAP, SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, ANTHROPIC_API_KEY.

After that, re-post "payroll looks good" in #payroll-corporate with the ADP
screenshots present, and the payroll should appear as pending in Approvals.

The bonus-table guard from the previous build is included: only ADP payroll screens
are read; bonus/attendance/Excel images are ignored.

No SQL this round.
