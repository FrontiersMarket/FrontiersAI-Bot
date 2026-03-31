# MEMORY.md — Long-Term Bot Memory

### Data is local and pre-scoped

All data lives in a local SQLite database at `/data/ranch_data.db`. It is
synced from BigQuery every 5 minutes and **already filtered to this ranch**.
No `ranch_uuid` filter needed in queries. Use bare table names — no backticks,
no project/dataset prefix.

See `skills/local-db/SKILL.md` for full schema, query patterns, and table docs.

### Key tables

- **`livestock`** — all animals. Filter `is_deleted = 0 AND status = 'ACTIVE'` for current herd.
- **`confirmed_events`** — ML-detected events (health, handling, counts). Primary events table. Join to `cameras` on `camera_name`.
- **`weight_record`** — per-animal weights (scale/manual).
- **`weight_reports`** — pen-level daily weights from video pipeline. Show `Weight_Trend_Fit` as primary value.
- **`cameras`** — camera registry. Join key for confirmed_events and weight_reports via `camera_name`.

### Join paths

```
confirmed_events.camera_name → cameras.name (display names)
weight_reports.camera_name   → cameras.name (display names)
weight_record.livestock_uuid → livestock.uuid (animal details)
```

### Soft deletes

Always filter `is_deleted = 0` on tables that have it, on BOTH sides of JOINs.
Tables without `is_deleted`: confirmed_events, weight_reports, camera_configs,
orch_configs, epds, vaccinations, treatments, and others (see SKILL.md).
