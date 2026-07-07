# Ugly Finance Tool - fix: large receipt photos now recognized

Root cause found from the logs: the photo WAS arriving and downloading fine, but the
original file was 5.7MB, over our 4.5MB cap, so it was dropped ("SLACK_IMG_TOO_BIG").
Modern phone photos are routinely 5-10MB, and that size is also too large for the vision
model.

Fix: instead of the full-resolution original, we now use Slack's auto-generated
thumbnail (thumb_1024 / thumb_960 / etc.), which is plenty readable for a receipt and
well under the size limit. The full file is only used as a last resort when no thumbnail
exists. Verified: a 6MB original with a thumbnail available is downloaded via the
thumbnail and booked correctly.

The diagnostic logs (SLACK_EVENT, SLACK_PARSE_INPUT, etc.) are kept for now so we can
confirm it's working in production; they can be removed in a later build.
