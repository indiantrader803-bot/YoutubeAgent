# Report collector (optional, for the maintainer)

Option 3 in **Report a problem** ("Send directly") needs a place to receive the text. This Worker is that place. Until you set it up, option 3 shows "not set up" and options 1 and 2 still work.

1. `cd tools/report-worker`
2. `npx wrangler kv namespace create REPORTS`, paste the printed id into `wrangler.toml`.
3. `npx wrangler deploy` and copy the Worker URL (`https://neonclipping-reports.<you>.workers.dev`).
4. Put that URL in `report.py` as `DEFAULT_REPORT_URL` (so every user gets it), or for testing set `NEONCLIPPING_REPORT_URL`, or write `{"url": "..."}` into `data/report.json`.
5. Read reports: `npx wrangler kv key list --binding REPORTS` then `npx wrangler kv key get --binding REPORTS "<key>"`.

What is stored: the diagnostics text the user saw and ticked a box to send, the date, and error labels. Reports expire after 60 days. The Worker does not store IPs or headers (Cloudflare's own logs still exist on your account).
Free plans have daily request limits: check Cloudflare's pricing page. Anyone can POST to the URL, so expect some junk; the Worker only accepts text that starts with "NeonClipping diagnostics" and is under 30 KB.
