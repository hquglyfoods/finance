// netlify/functions/slack-events.js
// Single Slack Event Subscriptions entry point. A Slack app has ONE request URL, but
// we have two independent handlers (expense capture + payroll capture). This router
// receives every event and dispatches to the right one based on the channel:
//   - the #payroll-corporate channel (PAYROLL_CHANNEL_ID) -> slack-payroll
//   - any channel in SLACK_CHANNEL_MAP (expense-*)          -> slack-expense
//
// Point the Slack app's Event Subscriptions Request URL at THIS function:
//   https://uglyfinance.netlify.app/.netlify/functions/slack-events
// Keep both message.channels and message.groups subscribed (expense-* channels are
// private and need message.groups; payroll-corporate is private too).

const expense = require('./slack-expense.js');
const payroll = require('./slack-payroll.js');

function parseChannelMap() {
  const out = {};
  (process.env.SLACK_CHANNEL_MAP || '').split(',').map(s => s.trim()).filter(Boolean)
    .forEach(pair => { const [id, code] = pair.split('='); if (id && code) out[id.trim()] = code.trim(); });
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  // URL verification handshake must be answered here (before any dispatch).
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  if (body.type === 'url_verification') return { statusCode: 200, body: body.challenge };

  const ev = body.type === 'event_callback' ? (body.event || {}) : null;
  const channel = ev && ev.channel;

  const payrollChannel = (process.env.PAYROLL_CHANNEL_ID || '').trim();
  const expenseMap = parseChannelMap();

  // Route by channel. Each underlying handler still does its own signature check,
  // subtype filtering, and idempotency, so we only decide WHICH one to call.
  if (channel && payrollChannel && channel === payrollChannel) {
    return payroll.handler(event);
  }
  if (channel && expenseMap[channel]) {
    return expense.handler(event);
  }

  // Not a channel we care about (or not a message event). Ack so Slack stops retrying.
  return { statusCode: 200, body: 'ignored (unrouted)' };
};
