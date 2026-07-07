# Ugly Finance Tool - Slack photo diagnostic logging

Text expenses work but photo-only posts don't get recognized, and files:read is present,
so this build adds temporary diagnostic logging to slack-expense.js to pinpoint the cause.
After deploying, post a receipt photo in an expense channel and check the Netlify function
logs for slack-expense (or slack-events). You'll see one or more of:

- SLACK_EVENT {...}         -> what Slack actually sent (subtype, whether files are
                               attached, and whether each file has a download URL).
- SLACK_IMG_HTTP <status>   -> the image download returned a non-200 (e.g. 403).
- SLACK_IMG_NOT_IMAGE <ct>  -> Slack returned HTML instead of an image (usually the bot
                               isn't in that channel, or a token/scope issue).
- SLACK_PARSE_INPUT {...}   -> how many images were successfully downloaded.

What the logs will tell us:
- If there's NO SLACK_EVENT line when you post a photo -> Slack isn't sending the event
  (event subscription / the bot isn't receiving file_share in that channel).
- If SLACK_EVENT shows files but SLACK_IMG_NOT_IMAGE / SLACK_IMG_HTTP appears -> the event
  arrives but the download fails (bot not in channel, or private-channel file access).
- If SLACK_PARSE_INPUT shows image_count > 0 -> images downloaded fine and the issue is
  downstream (parsing), which we can then look at.

Send me the log lines and I'll fix the exact cause. These logs are safe to remove after.
