# Prompt to paste into the Ugly HR app chat

Copy everything below the line into the HR app's chat. It tells that build to POST a
payroll summary to the Finance app after the owner has entered hours into ADP.

Fill in the two bracketed values first:
- [FINANCE_WEBHOOK_URL] -> https://uglyfinance.netlify.app/.netlify/functions/payroll-ingest
- [SHARED_SECRET] -> the value you will set as PAYROLL_INGEST_TOKEN in the Finance app's
  Netlify env vars. Pick any long random string; it must match on both sides.

---

We need to send our weekly payroll summary from this HR app to our Finance app, which
books it into the P&L. The Finance app already exposes a webhook for this. Please add a
"Send payroll to Finance" action.

## Endpoint

POST [FINANCE_WEBHOOK_URL]

Headers:
- Content-Type: application/json
- X-Payroll-Token: [SHARED_SECRET]

Body (JSON):
{
  "period_end": "YYYY-MM-DD",
  "entries": [
    { "store": "AD", "payroll": <number>, "payroll_tax": <number> },
    { "store": "BW", "payroll": <number>, "payroll_tax": <number> },
    { "store": "FH", "payroll": <number>, "payroll_tax": <number> }
  ],
  "source_note": "HR app",
  "correction": false
}

## Field rules

- `period_end`: the Sunday that closes the work week this payroll covers (our pay period is
  weekly, Monday to Sunday). This is the date the amounts get booked under, so it must be
  correct. Use the pay-period end, not the pay date.
- `store`: our store codes exactly: "AD", "BW", "FH". Send one entry per store.
- `payroll`: that store's total gross pay for the week, taken from the ADP payroll
  summary the owner uploads back into this app after payroll runs (the ADP "Gross Pay"
  total). Regular labor cost, before employer taxes. Send the ADP figure, not this app's
  own hours-based estimate.
- `payroll_tax`: that store's employer payroll taxes for the week, from that same ADP
  summary (the ADP "Employer Taxes" total). Do NOT add this into `payroll`; keep them
  separate.
- Send plain numbers (e.g. 3910.22), not strings, no "$" or commas.
- Omit a store, or send 0, if it had no payroll that week.
- `correction`: leave false (or omit) for a normal send. Set true ONLY when the owner is
  deliberately re-uploading a corrected ADP summary for a week that was already sent; see
  "Corrections" below.

## When to send

Add a clearly labeled button on the payroll screen, something like "Submit to Finance",
available only after the owner has confirmed the week's hours and entered them into ADP.
Do not send automatically on every edit; it should be an explicit action so we control
when the numbers become official.

## Handling the response

The webhook returns JSON:
- 200 { "ok": true, "saved": <n>, "corrected": <n>, "skipped": <n>, "period_end": "...", "stores": [...] }
  Show a success message like "Payroll sent to Finance (3 stores)". If `saved` is 0,
  `corrected` is 0, and `skipped` > 0, show "This week was already sent to Finance" (it
  safely ignored a repeat). If `corrected` > 0, show "Correction applied in Finance".
- 401 -> the token is wrong; show "Finance rejected the request (auth)". 
- 400 or 422 -> show the `error` / `detail` field text so we can fix the input.
- Any network error -> show a retry option; sending the same week again is safe (the
  Finance app de-duplicates by store + week, so a resend never double-books).

## Safe to resend, and how corrections work

The Finance side is keyed per store per week (not by amount). Behaviour:

- Normal send (`correction` false or omitted): if a store+week was already sent, it is
  left untouched and the resend is a safe no-op. Tapping the button twice, or retrying
  after a network error, never double-books. The response shows these as `skipped`.
- Correction (`correction: true`): the store+week's amount is overwritten with the new
  ADP figure. Use this only when the owner is fixing a week that was already sent, by
  re-uploading the corrected ADP summary and choosing a "Submit correction" action.

So the flow is: the normal button sends with correction=false. Offer a separate, clearly
labeled "Submit correction" action (or a confirm dialog) that sends the same payload with
correction=true, and only surface it when the owner explicitly wants to fix an
already-sent week. This prevents an accidental silent change to payroll that was already
approved in Finance.

Note for the owner (not something the app must enforce): correcting a week whose month was
already closed and reported in Finance means that month's report should be re-published so
the numbers match.

## What NOT to change

- Keep our existing hours calculation and ADP workflow exactly as they are. This is only a
  new outbound POST of the final weekly totals.
- Store the secret and URL as configuration / environment values in this app, not
  hard-coded in a component that ships to the browser if this app has any server side; if
  this app is purely client-side, tell me, because we should not expose the secret in the
  browser and may need to route it through a small serverless function instead.
