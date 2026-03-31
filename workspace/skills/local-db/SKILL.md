---
name: local-db
description: >
  Query the local SQLite ranch database at /data/ranch_data.db.
  Use for ALL data queries about ranches, livestock, cattle records, weights,
  BCS scores, vaccinations, notes, groups, pastures, cameras, videos, events,
  weight trends, pen-level reports, and any other Frontiers Market data.
  This database is a ranch-scoped materialized view synced from multiple
  BigQuery datasets — do NOT query BigQuery (bq CLI) directly.
---

# Local DB — Ranch Data Skill

## SCOPE — Always Pre-Filtered

All data in this database has already been filtered to the scoped ranch UUID at
sync time. **You do not need to add a `ranch_uuid` filter to your queries** —
the data is already ranch-specific.

You MUST still filter `is_deleted = 0` (soft-deleted rows are included in the
sync) unless the user explicitly asks about deleted records. Not all tables have
`is_deleted` — see table docs below.

---

## CRITICAL RULES — Read Before Every Query

1. **ALWAYS use `confirmed_events` for AI/ML-detected events — NEVER `video_events`.**
   `video_events` is outdated and will return stale/incorrect data.
   `confirmed_events` is the v2 replacement with richer schema.

2. **Ensure you have read `MEMORY.md` and `LEARNED.md` this session.**
   They contain active filters (e.g. hidden cameras), display preferences,
   and query corrections. If you haven't read them yet, do it now before
   writing your first query.

3. **Events disambiguation:** When user says "events" or "detections" → query `confirmed_events`.
   Only use the `events` table when user explicitly asks about calendar/schedule.

---

## Execution

```bash
sqlite3 -json /data/ranch_data.db "SQL HERE"
```

Always use `-json` for structured output. For large results:

```bash
sqlite3 -json /data/ranch_data.db "SQL" | head -c 100000
```

For multi-line SQL, use a heredoc:

```bash
sqlite3 -json /data/ranch_data.db "$(cat <<'SQL'
SELECT
  l.ear_tag_id,
  l.name,
  w.weight
FROM livestock l
JOIN weight_record w ON w.livestock_uuid = l.uuid
WHERE l.is_deleted = 0 AND w.is_deleted = 0
ORDER BY w.date_weighed DESC
LIMIT 50
SQL
)"
```

---

## Data Sources

This database syncs from three BigQuery datasets. All tables live in one
SQLite file — use bare table names with no prefix.

| Source Dataset | Tables | What it covers |
|---|---|---|
| `public` | ranch, livestock, cameras, weight_record, group, land, epds, note_record, expenses, income, + many more | Core ranch & livestock operational data |
| `event_detection_v2` | confirmed_events | ML-detected events (health, handling, animal counts) |
| `user_video_upload` | weight_reports, camera_configs, orch_configs, processing_pipeline_results | Video weight pipeline — pen-level weights & camera config |

---

## HIGH PRIORITY TABLES

These are the tables the bot uses most. Know them well.

### `ranch`

Single row — this ranch's info.

| Column | Type | Notes |
|---|---|---|
| `uuid` | TEXT | Ranch UUID |
| `name` | TEXT | Ranch name |
| *(other columns vary)* | | General ranch metadata |

### `livestock`

The central entity — every animal on this ranch.

| Column | Type | Notes |
|---|---|---|
| `uuid` | TEXT | Primary key |
| `ear_tag_id` | TEXT | Visual tag ID (user-facing) |
| `name` | TEXT | Animal name (nullable) |
| `status` | TEXT | `ACTIVE`, `INACTIVE`, `SOLD`, `DEAD`, `REFERENCE` |
| `sex` | TEXT | Sex of animal |
| `breed` | TEXT | Breed |
| `group_uuid` | TEXT | FK → `"group".uuid` (nullable — use LEFT JOIN) |
| `land_uuid` | TEXT | FK → `land.uuid` (nullable — use LEFT JOIN) |
| `sire_uuid` | TEXT | FK → `livestock.uuid` (nullable) |
| `dam_uuid` | TEXT | FK → `livestock.uuid` (nullable) |
| `dob` | TEXT | Date of birth |
| `is_deleted` | INTEGER | 0/1 soft delete — always filter `= 0` |

**Active herd = `WHERE is_deleted = 0 AND status = 'ACTIVE'`**

Display: `COALESCE(l.name, l.ear_tag_id, 'Unknown')`

### `cameras`

Camera hardware registry. **Join key for ML tables** (confirmed_events, weight_reports).

| Column | Type | Notes |
|---|---|---|
| `uuid` | TEXT | Primary key (camera_uuid) |
| `name` | TEXT | Camera name — **join key for confirmed_events and weight_reports** |
| `display_name` | TEXT | Human-friendly name (nullable) |
| `ranch_uuid` | TEXT | FK → ranch |
| `is_deleted` | INTEGER | 0/1 |

Display: `COALESCE(c.display_name, c.name)`

### `weight_record`

**Per-animal** weight entries (from scale or manual entry).

| Column | Type | Notes |
|---|---|---|
| `livestock_uuid` | TEXT | FK → `livestock.uuid` |
| `weight` | REAL | Weight in lbs |
| `date_weighed` | TEXT | Date of weighing |
| `is_deleted` | INTEGER | 0/1 |

Use for: individual animal weights, "how much does #1042 weigh?"

### `confirmed_events` (from event_detection_v2)

ML-detected events from camera video analysis. Health alerts, animal handling
events, and animal counts. **This is the primary events table** — replaces the
old `video_events` table.

| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT | Unique event ID |
| `run_id` | TEXT | Pipeline run ID |
| `created_at` | TEXT | Timestamp of detection |
| `model_name` | TEXT | ML model used |
| `pipeline_version` | TEXT | Pipeline version |
| `gcs_uri` | TEXT | GCS path to processed clip — **internal, do not show to user** |
| `source_uri` | TEXT | GCS path to source video — **internal, do not show to user** |
| `chunk_index` | INTEGER | Video chunk number |
| `chunk_offset_s` | REAL | Offset in seconds within chunk |
| `date_str` | TEXT | Event date (DATE format) |
| `camera_name` | TEXT | **Join key → `cameras.name`** |
| `group_index` | INTEGER | Group/batch index within analysis |
| `window_index` | INTEGER | Time window index |
| `animal_id` | TEXT | Identified animal (nullable) |
| `specialist` | TEXT | Specialist model that made the decision |
| `decision` | TEXT | Final decision/classification |
| `event_type` | TEXT | Event category (health, handling, count, etc.) |
| `confidence` | REAL | Confidence score (0-1) |
| `severity` | TEXT | Severity level |
| `refined_start_t` | TEXT | Event start timestamp (refined) |
| `refined_end_t` | TEXT | Event end timestamp (refined) |
| `refined_grid_location_json` | TEXT | JSON — spatial location in frame |
| `description` | TEXT | **Human-readable event description — show this to user** |
| `reasoning` | TEXT | **AI reasoning — good context for detailed answers** |
| `triage_animal_json` | TEXT | JSON — triage details |
| `specialist_json` | TEXT | JSON — specialist model output |
| `error` | TEXT | Error message if detection failed (nullable) |

**No `is_deleted` column.** No `ranch_uuid` — scoped via camera_name at sync time.

**No playable video URL yet.** GCS URIs are internal paths. Playable URLs will
be available once camera_videos is seeded with matching video entries. Until
then, present events without video links.

### `weight_reports` (from user_video_upload)

**Pen/camera-level** daily weight data from the video pipeline. This is the
primary source for **group weight trends**.

| Column | Type | Notes |
|---|---|---|
| `Date` | TEXT | Report date |
| `ranch_uuid` | TEXT | FK → ranch |
| `camera_uuid` | TEXT | FK → `cameras.uuid` |
| `camera_name` | TEXT | **Join key → `cameras.name`** |
| `Pen_Median_RW5` | REAL | Smoothed pen median weight (rolling window 5-day) |
| `Weight_Trend_Fit` | REAL | **Linear regression weight prediction — primary display value** |
| `Entry_Weight` | REAL | Weight at pen entry |
| `Entry_Date` | TEXT | Date animals entered pen |
| `Estimated_Pen_ADG` | REAL | Average daily gain for pen |
| `source_video` | TEXT | Source video reference |

**No `is_deleted` column.**

Use for: pen weight trends, group ADG, "how are the cattle in Pen 120 gaining?"

**Display `Weight_Trend_Fit` as the primary weight value** — it's the ML
prediction. Use `Pen_Median_RW5` as supporting/smoothed context.

---

## TWO WEIGHT SOURCES — Know the Difference

| | `weight_record` | `weight_reports` |
|---|---|---|
| **Granularity** | Per animal | Per pen/camera |
| **Source** | Scale, manual entry, or AI prediction | Video pipeline (daily) |
| **Join key** | `livestock_uuid` → `livestock` | `camera_name` → `cameras` |
| **Primary column** | `weight` | `Weight_Trend_Fit` |
| **Use when** | User asks about a specific animal's weight | User asks about pen/group trends, ADG, weight curves |

If the user asks "how much do the cattle weigh?" without specifying — start
with `weight_reports` for a high-level pen summary, then offer per-animal
detail from `weight_record` as a follow-up.

---

## MEDIUM PRIORITY TABLES

### `"group"`

Livestock groups/pens. **Reserved word — must double-quote.**

| Column | Type | Notes |
|---|---|---|
| `uuid` | TEXT | Primary key |
| `name` | TEXT | Group name |
| `ranch_uuid` | TEXT | FK → ranch |
| `is_deleted` | INTEGER | 0/1 |

### `land`

Pastures and land parcels.

| Column | Type | Notes |
|---|---|---|
| `uuid` | TEXT | Primary key |
| `name` | TEXT | Pasture/parcel name |
| `ranch_uuid` | TEXT | FK → ranch |
| `is_deleted` | INTEGER | 0/1 |

### `epds`

Estimated Progeny Differences — genetic merit scores.

| Column | Type | Notes |
|---|---|---|
| `livestock_uuid` | TEXT | FK → `livestock.uuid` |
| `record_date` | TEXT | Date of EPD record |
| *(EPD-specific columns vary)* | | CED, BW, WW, YW, MILK, etc. |

**No `is_deleted` column.**

### `note_record`

User notes attached to animals.

| Column | Type | Notes |
|---|---|---|
| `livestock_uuid` | TEXT | FK → `livestock.uuid` |
| `record_date` | TEXT | Date of note |
| `note` | TEXT | Note content |
| `is_deleted` | INTEGER | 0/1 |

### `camera_configs` (from user_video_upload)

Key-value configuration per camera — context for weight prediction/counting.

| Column | Type | Notes |
|---|---|---|
| `config_id` | TEXT | Primary key |
| `ranch_uuid` | TEXT | FK → ranch |
| `camera_name` | TEXT | Join key → `cameras.name` |
| `camera_id` | INTEGER | Camera ID |
| `key` | TEXT | Config key name |
| `value` | TEXT | JSON value |
| `effective_date` | TEXT | When this config takes effect |

### `orch_configs` (from user_video_upload)

Key-value orchestration config per ranch.

| Column | Type | Notes |
|---|---|---|
| `config_id` | TEXT | Primary key |
| `ranch_uuid` | TEXT | FK → ranch |
| `key` | TEXT | Config key name |
| `value` | TEXT | JSON value |

---

## LOW PRIORITY TABLES

These tables exist in the database and may be queried, but are often
underpopulated. Listed here for reference.

### Record Tables (livestock-scoped)

All have `livestock_uuid`, `is_deleted` (INTEGER 0/1), and a date column.

| Table | Primary Date Column |
|-------|---------------------|
| `bcs_record` | `record_date` |
| `vaccination_record` | `record_date` |
| `calving_record` | `record_date` |
| `death_record` | `record_date` |
| `pregnancy_check_record` | `record_date` |
| `transfer_record` | `record_date` |
| `harvest_record` | `record_date` |
| `breeding_serv_record` | `record_date` |
| `doctoring_record` | `record_date` |
| `foot_score_record` | `record_date` |
| `worming_record` | `record_date` |
| `transaction_record` | `record_date` |
| `implant_record` | `record_date` |
| `udder_teat_record` | `record_date` |
| `ear_tag_record` | `record_date` |
| `culling_record` | `record_date` |
| `horning_record` | `record_date` |
| `heat_detect_record` | `record_date` |
| `transport_record` | `record_date` |
| `consign_record` | `record_date` |
| `exam_record` | `record_date` |
| `perm_record` | `record_date` |

### Advanced Livestock Tables

| Table | Primary Date | Notes |
|-------|-------------|-------|
| `vaccinations` | `vaccination_date` | Detailed — vaccine_name, dosage, administered_by |
| `treatments` | `treatment_date` | Detailed treatment records |
| `measurements` | `measurement_date` | Physical measurements |
| `breedings` | `breeding_date` | Breeding events |
| `carcass_data` | `slaughter_date` | Harvest/carcass data |
| `gain_tests` | — | ADG, RFI, gain test results |
| `gallery_item` | `created_at` | Animal photos |
| `breed_compositions` | — | Breed percentages |
| `ownerships` | — | Ownership records |

**None of these have `is_deleted`.**

### Ranch Operations

| Table | Primary Date |
|-------|-------------|
| `contacts` | `created_at` |
| `expenses` | `expense_date` |
| `income` | `income_date` |
| `rainfall` | `rainfall_date` |
| `events` | `start_at` |
| `equipment` | `created_at` |
| `tanks` | `created_at` |
| `semen` | `created_at` |
| `salesbook` | `date_of_sale` |
| `categories` | — |
| `ranch_settings` | — |
| `ranch_association` | — |
| `prediction_results` | — |
| `unverified_weight_records` | — |

### Camera & Video (supporting)

| Table | Notes |
|-------|-------|
| `camera_videos` | Video recordings — **join table only** (use for URL lookup, not direct queries) |
| `land_cameras` | Junction: camera ↔ pasture |
| `camera_reports` | Pen reports (access via `report_url`) |

### Pipeline (fallback)

| Table | Notes |
|-------|-------|
| `processing_pipeline_results` | Raw weight pipeline KV output. Dynamic schema. Prefer `weight_reports` instead. |

---

## KEY RELATIONSHIPS

```
livestock ──── weight_record          (livestock_uuid → livestock.uuid)
    │
    ├──── note_record                 (livestock_uuid → livestock.uuid)
    ├──── epds                        (livestock_uuid → livestock.uuid)
    ├──── [all record tables]         (livestock_uuid → livestock.uuid)
    │
    ├──── "group"                     (livestock.group_uuid → group.uuid)
    └──── land                        (livestock.land_uuid → land.uuid)

cameras ──── confirmed_events         (cameras.name = confirmed_events.camera_name)
    │
    ├──── weight_reports              (cameras.name = weight_reports.camera_name)
    ├──── camera_configs              (cameras.name = camera_configs.camera_name)
    ├──── camera_videos               (cameras.uuid = camera_videos.camera_uuid)
    └──── land_cameras                (cameras.uuid = land_cameras.camera_uuid)
```

**Two data worlds:**
- **Livestock world** — joins on `livestock_uuid` (individual animals)
- **Camera world** — joins on `camera_name` (pens/locations, ML data)

These worlds connect through `group` and `land` (a camera watches a pen, a pen
has a group of animals) — but this mapping is still in progress.

---

## SQLite vs BigQuery Syntax Differences

| BigQuery | SQLite equivalent |
|----------|-------------------|
| `` `group` `` (backtick) | `"group"` (double quote) |
| `QUALIFY ROW_NUMBER() OVER (...) = 1` | Use subquery with `WHERE rn = 1` |
| `TIMESTAMP_SECONDS(CAST(ts AS INT64))` | `datetime(ts, 'unixepoch')` |
| `CURRENT_TIMESTAMP()` | `datetime('now')` |
| `CURRENT_DATE()` | `date('now')` |
| `DATE_DIFF(d1, d2, DAY)` | `CAST(julianday(d1) - julianday(d2) AS INTEGER)` |
| `FORMAT_TIMESTAMP('%Y-%m-%d', ts)` | `strftime('%Y-%m-%d', ts)` |
| `EXTRACT(YEAR FROM ts)` | `strftime('%Y', ts)` |
| `SAFE_DIVIDE(a, b)` | `CASE WHEN b = 0 THEN NULL ELSE a * 1.0 / b END` |
| `is_deleted = false` | `is_deleted = 0` |
| `is_deleted = true` | `is_deleted = 1` |
| `ROUND(val, n)` | `ROUND(val, n)` (same) |
| `COALESCE(a, b)` | `COALESCE(a, b)` (same) |

---

## Key Query Patterns

### Livestock count (active herd)

```sql
SELECT COUNT(*) as count FROM livestock
WHERE is_deleted = 0 AND status = 'ACTIVE'
```

### Latest weight per animal (no QUALIFY in SQLite)

```sql
SELECT livestock_uuid, weight, date_weighed
FROM weight_record w1
WHERE is_deleted = 0
  AND date_weighed = (
    SELECT MAX(date_weighed) FROM weight_record w2
    WHERE w2.livestock_uuid = w1.livestock_uuid AND w2.is_deleted = 0
  )
```

### Livestock with latest weight (JOIN)

```sql
SELECT l.ear_tag_id, l.name, w.weight, w.date_weighed
FROM livestock l
JOIN weight_record w ON w.livestock_uuid = l.uuid
  AND w.is_deleted = 0
  AND w.date_weighed = (
    SELECT MAX(date_weighed) FROM weight_record
    WHERE livestock_uuid = l.uuid AND is_deleted = 0
  )
WHERE l.is_deleted = 0 AND l.status = 'ACTIVE'
ORDER BY w.weight DESC
LIMIT 50
```

### Animals in a group (reserved word)

```sql
SELECT l.ear_tag_id, l.name, g.name as group_name
FROM livestock l
JOIN "group" g ON g.uuid = l.group_uuid AND g.is_deleted = 0
WHERE l.is_deleted = 0 AND l.status = 'ACTIVE'
```

### BCS distribution

```sql
SELECT CAST(score AS INTEGER) as bcs_score, COUNT(*) as count
FROM bcs_record
WHERE is_deleted = 0
GROUP BY CAST(score AS INTEGER)
ORDER BY bcs_score
```

### Confirmed events — recent detections

```sql
SELECT
  ce.event_type,
  ce.date_str AS event_date,
  ce.confidence,
  ce.severity,
  ce.description,
  ce.decision,
  COALESCE(c.display_name, c.name) AS camera_name
FROM confirmed_events ce
LEFT JOIN cameras c ON c.name = ce.camera_name AND c.is_deleted = 0
ORDER BY ce.date_str DESC, ce.created_at DESC
LIMIT 20
```

Filter by type: `AND ce.event_type = 'health'`
Filter by date: `AND ce.date_str >= date('now', '-7 days')`
Filter by severity: `AND ce.severity = 'high'`

**Show `description` to the user** — it's a human-readable summary.
Use `reasoning` for follow-up detail if the user asks "why?"

### Pen weight trend (weight_reports)

```sql
SELECT
  wr."Date" AS report_date,
  COALESCE(c.display_name, c.name) AS camera_name,
  wr.Weight_Trend_Fit AS predicted_weight,
  wr.Pen_Median_RW5 AS smoothed_weight,
  wr.Estimated_Pen_ADG AS adg
FROM weight_reports wr
LEFT JOIN cameras c ON c.name = wr.camera_name AND c.is_deleted = 0
ORDER BY wr."Date" DESC
LIMIT 30
```

**Show `Weight_Trend_Fit` as the primary weight** — label it as "estimated weight"
or "predicted weight." Use `Pen_Median_RW5` as supporting context.

### Pen weight over time (for charts)

```sql
SELECT
  wr."Date" AS report_date,
  COALESCE(c.display_name, c.name) AS pen,
  wr.Weight_Trend_Fit AS weight,
  wr.Estimated_Pen_ADG AS adg
FROM weight_reports wr
LEFT JOIN cameras c ON c.name = wr.camera_name AND c.is_deleted = 0
WHERE wr."Date" >= date('now', '-30 days')
ORDER BY wr.camera_name, wr."Date"
```

### Check last sync time

```sql
SELECT table_name, source, last_sync_at, row_count, error
FROM _sync_meta
ORDER BY last_sync_at DESC
```

---

## Soft Delete Rules

Always filter `is_deleted = 0` on every table that has the column **and on
both sides of JOINs**:

```sql
-- Correct:
WHERE l.is_deleted = 0 AND w.is_deleted = 0

-- Wrong (inflated counts):
WHERE l.is_deleted = 0
```

**Tables WITHOUT `is_deleted`** (no filter needed): `ranch`, `confirmed_events`,
`weight_reports`, `camera_configs`, `orch_configs`, `processing_pipeline_results`,
`vaccinations`, `treatments`, `measurements`, `carcass_data`, `breedings`,
`breed_compositions`, `ownerships`, `gain_tests`, `contacts`, `equipment`,
`tanks`, `semen`, `categories`, `expenses`, `income`, `rainfall`, `events`,
`ranch_settings`, `prediction_results`, `epds`.

---

## Livestock `status` Values

`ACTIVE`, `INACTIVE`, `SOLD`, `DEAD`, `REFERENCE`

Always pair `status = 'ACTIVE'` with `is_deleted = 0` for the current herd.

---

## NULL Handling

Nullable FK columns: `sire_uuid`, `dam_uuid`, `group_uuid`, `land_uuid`, `name`

Always use `LEFT JOIN` for these — `INNER JOIN` silently drops animals with no
group or land assigned.

Display NULLs gracefully:

```sql
COALESCE(l.name, l.ear_tag_id, 'Unknown') as display_name
```

---

## Error Recovery

| Error | Cause | Fix |
|-------|-------|-----|
| `no such table` | Table not synced (no data in BQ) | Tell user data not available |
| `no such column` | Column name wrong | Check schema in this SKILL.md |
| Parsing error | Reserved word not quoted | Use `"group"` not `group` |
| Empty result | `is_deleted` not filtered | Add `WHERE is_deleted = 0` |

---

## Response Format

- Present data cleanly — no raw SQLite output, no query details
- Format numbers: `1,234` not `1234`; weights: `847 lbs` not `847`
- Summarize large results (200+ rows → key stats)
- File exports → write to `results/` inside this skill folder
- Check `_sync_meta` table if user asks when data was last updated
- **Follow platform formatting rules from AGENTS.md** — especially: iMessage is plain text only (no markdown, no asterisks, no headers, no bullet syntax), Slack uses `mrkdwn` (`*bold*` not `**bold**`)
