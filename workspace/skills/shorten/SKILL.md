---
name: shorten
description: Shorten URLs using is.gd (no auth required). Returns a permanent short link.
---

# Shorten

Shorten URLs using [is.gd](https://is.gd). No API key or account required.

## Usage

Always call via full path — `shorten` is NOT in PATH:

```bash
/data/workspace/skills/shorten/shorten.sh "https://example.com/very/long/url"
# Output: https://is.gd/O5d2Xq
```

## Batch shortening (multiple URLs)

Run once per URL — do NOT pass multiple URLs in one call:

```bash
/data/workspace/skills/shorten/shorten.sh "$URL1"
/data/workspace/skills/shorten/shorten.sh "$URL2"
```

## Fallback on failure

If the script exits non-zero or returns an error string, use the original URL instead — never drop the link:

```bash
SHORT=$(/data/workspace/skills/shorten/shorten.sh "$URL")
if [ $? -ne 0 ] || [[ "$SHORT" == "❌"* ]]; then
  SHORT="$URL"
fi
```

## When to use

- **Always** — any video URL must be shortened before sharing
- **Always** — any long URL shared with the user in chat should be shortened
- Never present raw long URLs when a short version can be obtained

## Notes

- Links are permanent.
- Rate limits apply — space out requests if shortening many URLs (>5) in one response.
- No analytics dashboard (simple redirect).
