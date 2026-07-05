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
  toast-sync.js                   # Daily: store sales + tips from Toast
  quickbooks-sync.js              # Daily: HQ revenue from QuickBooks Online
  qbo-auth.js                     # One-time QuickBooks OAuth connection
  ummas-revenue.js                # Webhook: Ummas website posts daily revenue
  slack-expense.js                # Slack channel -> pending expenses
```

## Netlify environment variables
Core:
- SUPABASE_URL, SUPABASE_SERVICE_KEY, ALLOWED_ORIGIN, SITE_URL

Toast (after Standard API access approval):
- TOAST_CLIENT_ID, TOAST_CLIENT_SECRET
- TOAST_RESTAURANTS = "AD:guid,BW:guid,FH:guid"

QuickBooks (after creating an Intuit developer app):
- QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_SETUP_SECRET

Ummas website:
- UMMAS_WEBHOOK_SECRET

Slack (after creating a Slack app):
- SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID
