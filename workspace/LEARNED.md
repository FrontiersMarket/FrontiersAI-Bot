# LEARNED.md — Corrections, Preferences & Workflows

This file is maintained by the bot based on user feedback and team directives.
When a user corrects you, teaches you a preference, or says "remember this" —
write it here. Keep entries concise, dated, and grouped by topic.

---

## Customer

Friona Industries — headquartered in Amarillo, TX. Large-scale cattle feedyard
operation. All data in this bot is scoped to their ranch. (2026-03-30)

---

## Workflows — Standard Requests

### "Loadout report" / "Loading report"

Generate a PDF report of events from **loading zone cameras only** (K1H and K2H
series: K1H Chute, K1H North Loadout, K1H North Processing, K2H Processing,
K2H East Loadout, K2H West Loadout, K2H West Processing, etc.).

1. Query `confirmed_events` filtered to loading zone cameras
2. Include these event types: **truck events** (TRUCK_LOAD_IN, TRUCK_LOAD_OUT),
   **beef quality assurance** events, and **inventory count** events
3. Group by date and camera
4. Generate PDF via **report-generator** skill
5. Deliver inline (Slack upload or iMessage attachment)

Do NOT include pen cameras (friona1–8) in loadout reports. (2026-03-30)

### "Weight chart for pen X" / "How is pen X gaining?"

Generate a line chart of weight predictions for a specific pen's camera(s).

1. Identify the camera(s) at the requested pen by joining `cameras` → `land`
   (or use known pen-to-camera mappings)
2. Query `weight_reports` for those camera(s), ordered by `Date`
3. Plot `Weight_Trend_Fit` (primary) over time as a line chart via
   **python-dataviz** skill
4. Optionally overlay `Pen_Median_RW5` as a secondary smoothed line
5. Deliver chart inline with a brief text summary (current weight, ADG, trend)

(2026-03-30)

---

## Camera Display Rules

- Do not show friona2-1, friona2-2, friona2-4, friona3-1, friona3-2,
  friona3-4, friona4-1, friona4-2, or friona4-4 unless specifically asked for.
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
