// netlify/functions/inventory-sync-now.js
// Manual trigger for inventory-sync, so you don't have to wait for the hourly
// schedule. Protected by WEBHOOK_SECRET. Reuses the exact same sync logic and
// returns its diagnostic JSON.
//
// Run it from a browser:
//   https://uglyfinance.netlify.app/.netlify/functions/inventory-sync-now?key=YOUR_WEBHOOK_SECRET
// Optional backfill range:
//   ...&from=2026-06-01&to=2026-06-30

const sync = require('./inventory-sync.js');

exports.handler = async (event) => {
  const rawKey = ((event.queryStringParameters || {}).key || '').trim().replace(/^[<]+|[>]+$/g, '');
  const secret = (process.env.WEBHOOK_SECRET || '').trim();
  if (!secret || rawKey !== secret) return { statusCode: 401, body: 'unauthorized' };
  // pass through from/to if provided; the sync reads event.queryStringParameters
  return sync.handler(event);
};
