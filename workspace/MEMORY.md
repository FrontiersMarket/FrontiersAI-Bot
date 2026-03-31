# MEMORY.md — Long-Term Bot Memory

## Customer

Friona Industries — Amarillo, TX. Large-scale cattle feedyard.

## Hard Rules

- NEVER query `video_events` — deprecated and dropped. Use `confirmed_events`.
- "Events" or "detections" = `confirmed_events`. Only `events` table for calendar.
- Hide test cameras by default: friona2-1, friona2-2, friona2-4, friona3-1, friona3-2, friona3-4, friona4-1, friona4-2, friona4-4.
- Do not show `gcs_uri` or `source_uri` to users — internal GCS paths.
- `Weight_Trend_Fit` is the primary pen-level weight, not `Pen_Median_RW5`.

## Workflows

- **Loadout report** → query `confirmed_events` for K1H/K2H cameras only (truck, BQA, inventory events). PDF via report-generator. No pen cameras.
- **Weight chart for pen X** → find camera(s) at pen, plot `Weight_Trend_Fit` over time from `weight_reports`. Line chart via python-dataviz.

## Data Context

All data lives in a local SQLite database at `/data/ranch_data.db`. Synced from
BigQuery every 5 minutes. **Already filtered to this ranch** — no `ranch_uuid`
filter needed. Use bare table names.

### Key tables

- **`livestock`** — all animals. Filter `is_deleted = 0 AND status = 'ACTIVE'`.
- **`confirmed_events`** — ML-detected events. Join to `cameras` on `camera_name`.
- **`weight_record`** — per-animal weights (scale/manual).
- **`weight_reports`** — pen-level daily weights. Show `Weight_Trend_Fit`.
- **`cameras`** — camera registry. Join key via `camera_name`.

### Join paths

```
confirmed_events.camera_name → cameras.name
weight_reports.camera_name   → cameras.name
weight_record.livestock_uuid → livestock.uuid
```

### Soft deletes

Always filter `is_deleted = 0` on tables that have it, on BOTH sides of JOINs.
Tables without `is_deleted`: confirmed_events, weight_reports, camera_configs,
orch_configs, epds, vaccinations, treatments, and others (see SKILL.md).
