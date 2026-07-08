# Ugly Finance Tool - Slack expense photos: resize large images so they always import

Root cause: the Anthropic image API rejects any image whose base64 payload exceeds 5MB. A
5.92MB photo (base64 ~7.9MB) is refused, so a photo with no usable Slack thumbnail was
being dropped. Now we resize large originals locally before sending.

How it works now (slack-expense):
1. Try Slack's auto-thumbnails first (1024/960/800/720/640/480) - usually solves it with
   no resize needed.
2. If a thumbnail is missing or itself too big, download the original and resize it with
   Jimp (a pure-JavaScript image library - no native binary, so it runs reliably on
   Netlify): long edge capped at 1600px, JPEG quality 80, stepping quality down if needed
   until it's safely under the API's 5MB limit. A 29MB test photo comes out ~1.5MB.
3. Small, already-supported images pass through untouched (no quality loss).

Notes:
- Added "jimp" to package.json; Netlify installs it on build. netlify.toml marks jimp as an
  external module for the slack-expense function so esbuild ships it from node_modules.
- HEIC/HEIF that Jimp can't decode still rely on Slack's JPEG thumbnail (which is tried
  first anyway).
- Diagnostic logs remain: SLACK_IMG_TRY, SLACK_IMG_RESIZED, SLACK_IMG_RESIZE_FAILED,
  SLACK_PARSE_INPUT, SLACK_PARSE_FAILED.

After deploying (Netlify will run npm install to pull jimp), re-post the American Dream
photo - it should now import. If anything still fails, the SLACK_IMG_* / SLACK_PARSE_*
logs will show the exact step.
