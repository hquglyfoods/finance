# Ugly Finance Tool

Internal financial management and investor reporting app for Ugly Donuts & Corn Dogs HQ.

## Structure
```
index.html                        # Single-page app (React via Babel CDN)
netlify.toml                      # Netlify config + scheduled function
package.json                      # Function dependency (@supabase/supabase-js)
netlify/functions/
  create-account.js               # Owner-only account creation (auth + profile + permissions)
  recurring-cron.js               # Daily cron: materializes recurring expenses
```

## Netlify environment variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` (service_role secret, never expose in client code)
- `ALLOWED_ORIGIN` (deployed site URL, e.g. https://uglyfinance.netlify.app)

## Database
Supabase project (separate from ops/CRM). One-time setup scripts are kept
outside this repo: schema, historical import, storage policies.
