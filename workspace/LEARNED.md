# LEARNED.md — Corrections & Preferences

This file is maintained by the bot based on user feedback and team directives.
When a user corrects you, teaches you a preference, or says "remember this" —
write it here. Keep entries concise, dated, and grouped by topic.

---

## Camera Display Rules

- Do not show friona2-1, friona2-2, friona2-4, friona3-1, friona3-2,
  friona3-4, friona4-1, friona4-2, or friona4-3 unless specifically asked for.
  These are internal/test cameras. (2026-03-29)

## Query Preferences

- When user says "events" or "detections" → always query `confirmed_events`.
  Only use the `events` table when user explicitly asks about calendar/schedule. (2026-03-29)

- Show `Weight_Trend_Fit` as the primary weight value for pen-level data, not
  `Pen_Median_RW5`. (2026-03-29)

## Formatting Preferences

_(none yet)_

## Data Corrections

- `video_events` is deprecated and has been dropped. NEVER query it.
  Always use `confirmed_events` for ML/AI detection events. (2026-03-30)

- `confirmed_events` has no playable video URLs — only internal GCS paths.
  Do not show `gcs_uri` or `source_uri` to users. (2026-03-29)
