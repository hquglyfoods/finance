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
  toast-sync.js                   # Daily: store sales + tips from Toast (AD/BW/FH)
  inventory-sync.js               # Daily: HQ invoices + Ummas orders from the
                                  #        Inventory app Supabase (read-only)
  slack-expense.js                # Slack channel -> pending expenses
```

## Data sources
- Toast API: AD/BW/FH daily sales by channel + card tips (expense).
- Inventory app Supabase (single source of truth for QuickBooks + Ummas + Wix):
  - source 'quickbooks' to a company store  -> HQ revenue + that store's HQ Supplies expense
  - source 'quickbooks' to Pearland          -> HQ revenue only (franchisee)
  - source 'ummasrecipe-store' / 'wix'       -> UMMA revenue
  Finance Tool reads it read-only with a dedicated key. No direct QuickBooks
  connection is needed (QuickBooks flows QB -> Zapier -> Inventory app).
- Slack: expense channel messages -> pending expenses for approval.

## Netlify environment variables
Core: SUPABASE_URL, SUPABASE_SERVICE_KEY, ALLOWED_ORIGIN, SITE_URL
Toast: TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANTS="AD:guid,BW:guid,FH:guid"
Inventory (read-only): INV_SUPABASE_URL, INV_SUPABASE_READ_KEY
  Optional: INV_CUSTOMER_MAP, INV_UMMA_MAP
Slack: SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID
