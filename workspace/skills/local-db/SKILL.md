---
name: local-db
description: >
  Query the local SQLite ranch database at /data/ranch_data.db.
  Use for ALL data queries about ranches, livestock, cattle records, weights,
  BCS scores, vaccinations, notes, groups, pastures, cameras, videos, events,
  and any other Frontiers Market operational data.
  This database is a ranch-scoped replica of the BigQuery dataset — do NOT
  query BigQuery (bq CLI) directly anymore.
---

# Local DB — Ranch Data Skill

## SCOPE — Always Pre-Filtered

All data in this database has already been filtered to the scoped ranch UUID at
sync time. **You do not need to add a `ranch_uuid` filter to your queries** —
the data is already ranch-specific.

You MUST still filter `is_deleted = 0` (soft-deleted rows are included in the
sync) unless the user explicitly asks about deleted records.

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

## Schema

Tables are the same as the BigQuery `frontiersmarketplace.public` dataset but:

- **No project/dataset prefix** — use bare table names: `livestock`, `weight_record`, etc.
- **No backticks** — SQLite uses double quotes for reserved words: `"group"`
- **BOOLEAN stored as INTEGER** — `0` = false, `1` = true (use `= 0` / `= 1`)
- **No `datastream_metadata` column** — STRUCT columns are not synced

### Core Entity Tables

| Table | Description |
|-------|-------------|
| `ranch` | Ranch/operation info (one row — this ranch only) |
| `livestock` | Animals — use `status` for lifecycle, `is_deleted` for soft-delete |
| `"group"` | Livestock groups — reserved word, must double-quote |
| `land` | Pastures and land parcels |
| `cameras` | Camera hardware |

### Record Tables

All have `livestock_uuid`, `is_deleted` (INTEGER 0/1), and a date column.

| Table | Primary Date Column |
|-------|---------------------|
| `weight_record` | `date_weighed` |
| `bcs_record` | `record_date` |
| `vaccination_record` | `record_date` |
| `note_record` | `record_date` |
| `calving_record` | `record_date` |
| `death_record` | `record_date` |
| `pregnancy_check_record` | `record_date` |
| `transfer_record` | `record_date` |
| `harvest_record` | `record_date` |
| `breeding_serv_record` | `record_date` |
| `doctoring_record` | `record_date` |
| `foot_score_record` | `record_date` |
| `worming_record` | `record_date` |
| *(and more — same pattern)* | `record_date` |

### Advanced Livestock Tables

| Table | Primary Date | Notes |
|-------|-------------|-------|
| `vaccinations` | `vaccination_date` | Detailed — has `vaccine_name`, `dosage`, `administered_by` |
| `treatments` | `treatment_date` | Detailed treatment records |
| `measurements` | `measurement_date` | Physical measurements |
| `epds` | `record_date` | Estimated Progeny Differences |
| `breedings` | `breeding_date` | Breeding events |
| `carcass_data` | `slaughter_date` | Harvest/carcass data |
| `gain_tests` | — | ADG, RFI, gain test results |
| `gallery_item` | `created_at` | Animal photos |

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

### Camera & Video

| Table | Notes |
|-------|-------|
| `cameras` | Camera hardware |
| `camera_videos` | Video recordings |
| `video_events` | AI-detected events (distress, calving, count, etc.) |
| `land_cameras` | Junction: camera ↔ pasture |
| `camera_reports` | Pen reports (access via `report_url`) |
| `prediction_results` | AI weight predictions |

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
| `ROUND(val, n)` | `ROUND(val, n)` ✓ same |
| `COALESCE(a, b)` | `COALESCE(a, b)` ✓ same |

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

### Recent video events

```sql
SELECT event_type, event_date, datetime(start_timestamp, 'unixepoch') as event_time, confidence
FROM video_events
WHERE is_deleted = 0
ORDER BY event_date DESC, start_timestamp DESC
LIMIT 20
```

### Video events with camera video URLs

When the user asks to **watch / see / view** a video for an event, join `video_events` to
`camera_videos` to get the actual video URL:

```sql
SELECT
  ve.event_type,
  ve.event_date,
  datetime(ve.start_timestamp, 'unixepoch') as event_time,
  ve.confidence,
  cv.video_url
FROM video_events ve
JOIN camera_videos cv ON cv.uuid = ve.video_uuid AND cv.is_deleted = 0
WHERE ve.is_deleted = 0
ORDER BY ve.event_date DESC, ve.start_timestamp DESC
LIMIT 20
```

**Important — URL shortening:** Every `video_url` returned from `camera_videos` MUST be
shortened using the **shorten** skill before presenting it to the user. Run the shorten
skill once per URL:

```bash
/data/workspace/skills/shorten/shorten.sh "<video_url>"
```

Always present the shortened URL to the user, never the raw long URL.

### Check last sync time

```sql
SELECT table_name, last_sync_at, row_count, error
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

Tables WITHOUT `is_deleted` (no filter needed): `ranch`, `vaccinations`,
`treatments`, `measurements`, `carcass_data`, `breedings`, `breed_compositions`,
`ownerships`, `gain_tests`, `contacts`, `equipment`, `tanks`, `semen`,
`categories`, `expenses`, `income`, `rainfall`, `events`, `ranch_settings`,
`prediction_results`.

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
