# Ugly Finance Tool

Internal financial management, investor reporting, and PWA for Ugly Donuts & Corn Dogs HQ.

## Structure
```
index.html                 # Single-page app (React via Babel CDN), PWA-enabled
manifest.webmanifest       # PWA manifest
sw.js                      # Service worker (no cache; push + notification handlers)
icons/                     # App icons (192, 512 maskable, apple-touch, badge)
netlify.toml               # Netlify config + scheduled functions
package.json               # Dependency for the supabase-based functions
netlify/functions/
  create-account.js        # Owner-only account creation
  recurring-cron.js        # Daily: recurring expenses
  toast-sync.js            # Hourly: Toast sales + tips
  inventory-sync.js        # Hourly: HQ invoices + Ummas from Inventory app
  slack-expense.js         # Slack expense channels -> AI-parsed pending
  push-notify.js           # Web push sender (triggered by Supabase DB webhooks)
  lib/push.js              # Zero-dependency web push (VAPID + RFC 8291)
```

## Push notifications
- New pending expense  -> owner + assistant devices
- New published report -> investor devices (for their corps)
- App badge: pending count (owner/assistant) or published report count (investor)

## Netlify environment variables
Core: SUPABASE_URL, SUPABASE_SERVICE_KEY, ALLOWED_ORIGIN, SITE_URL
Toast: TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANTS
Inventory: INV_SUPABASE_URL, INV_SUPABASE_READ_KEY
Slack: SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, ANTHROPIC_API_KEY, SLACK_CHANNEL_MAP
Push: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (PEM), WEBHOOK_SECRET, VAPID_SUBJECT (optional)

VAPID_PUBLIC_KEY = BDrfs4O7uc24B0CNFpqQf-4R2VYn2mW8e0qf2PiG5hinj6CQ5NqmfZrZ6VAI-J7OZOwFR16OTM5PTcCLu3EUL_A
