# Ugly Finance Tool

Internal financial management and investor reporting app for Ugly Donuts & Corn Dogs HQ.

## Structure
```
index.html                        # Single-page app (React via Babel CDN)
netlify.toml                      # Netlify config + scheduled functions
package.json                      # Function dependency (@supabase/supabase-js)
netlify/functions/
  create-account.js               # Owner-only account creation
  recurring-cron.js               # Daily: generates due recurring expenses
  toast-sync.js                   # Hourly: store sales + tips from Toast (AD/BW/FH)
  inventory-sync.js               # Hourly: HQ invoices + Ummas orders from Inventory app
  slack-expense.js                # expense-* Slack channels -> AI-parsed pending expenses
```

## UI
Desktop: left sidebar. Mobile: top brand bar + bottom tab bar with icons.
Forms, KPI cards, approvals, tables, and the cash calendar all adapt to phone
width. Toasts float above the tab bar and never block taps. Long names wrap
inside table cells without horizontal overflow.

## Netlify environment variables
Core: SUPABASE_URL, SUPABASE_SERVICE_KEY, ALLOWED_ORIGIN, SITE_URL
Toast: TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANTS="AD:guid,BW:guid,FH:guid"
Inventory (read-only): INV_SUPABASE_URL, INV_SUPABASE_READ_KEY  [optional INV_CUSTOMER_MAP, INV_UMMA_MAP]
Slack: SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, ANTHROPIC_API_KEY,
       SLACK_CHANNEL_MAP="C06EWSFHS86=AD,C06ENV96HDM=BW,C06FS9MH0F2=FH"
