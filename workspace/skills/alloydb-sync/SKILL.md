---
name: alloydb-sync
description: >
  Query ranch, livestock, cattle records, lands, groups, cameras, videos, events and more data from Google BigQuery 'frontiersmarketplace.public' dataset.
  Use when the user asks about ranches, cattle, livestock counts, weight records, BCS scores,
  vaccination history, notes, groups, pastures, or any Frontiers Market operational data.
---

# AlloyDB Sync — Data Skill

## Workflow

1. **Resolve entities** — Map ranch names → UUIDs, animal tags/names → livestock UUIDs.
2. **Build & execute query** — Use cached schema, apply soft-delete filters, optimize for speed.
3. **Format for channel** — Adapt to active platform (see AGENTS.md → Platform Formatting).
4. **Present results** — Concise summary with context. Offer follow-ups when relevant.
5. **On failure** — Try a different approach silently. Report only as last resort (short, non-technical).

---

## Soft Delete Rule — ALWAYS APPLY

Every table with `is_deleted` must include `WHERE is_deleted = false` by default.
Only omit if the user explicitly asks about deleted/archived records.

Apply on **both sides** of JOINs — both tables may have the column:

```sql
WHERE l.is_deleted = false AND w.is_deleted = false
```

For livestock, combine both filters when user wants current herd:

```sql
WHERE is_deleted = false AND livestock_status = 'ACTIVE'
```

**`ranch` table has NO `is_deleted` column** — do not filter it.

**BOOLEAN comparison:** Always use `= false` / `= true`. Never use `= 0`, `= 1`, `= 'false'`, or `IS NULL`.

---

## Schema Memory

Cache schema in `memory/bq-schema.md`. On first use (no cache): run discovery query, write results.

```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json --max_rows=5000 \
  'SELECT table_name, column_name, data_type FROM `frontiersmarketplace.public`.INFORMATION_SCHEMA.COLUMNS ORDER BY table_name, ordinal_position'
```

**Subsequent sessions:** Read cache → query directly. Do NOT re-run schema discovery unless:

- A query fails with "table not found" or "column not found"
- User says schema changed
- Cache is older than 7 days

---

## Intent → Table Mapping

| User asks                 | Table(s)             | Notes                                                            |
| ------------------------- | -------------------- | ---------------------------------------------------------------- |
| cattle count / herd       | `livestock`          | Filter `is_deleted=false` + `ACTIVE`                             |
| ranch info / location     | `ranch`              | No `is_deleted` column                                           |
| weight / gain             | `weight_record`      | Use `recorded_at` for chronology                                 |
| BCS scores                | `bcs_record`         | Cast score to INT64 when grouping                                |
| vaccinations              | `vaccination_record` | Use `administered_at` for chronology                             |
| notes / observations      | `note_record`        | Use `recorded_at` for chronology                                 |
| groups / herds            | `group`              | `group` is a reserved word — always use backticks: `` `group` `` |
| pastures / land           | `land`               |                                                                  |
| cameras / camera          | `cameras`            |                                                                  |
| videos / recordings/clips | `camera_videos`      |                                                                  |
| events / detections       | `video_events`       |                                                                  |

**Resolve ranch by name** — always start with this before any ranch-scoped query:

```sql
SELECT uuid, ranch_name, city, state_short
FROM `frontiersmarketplace.public.ranch`
WHERE LOWER(ranch_name) LIKE LOWER('%input%') LIMIT 5
```

**Resolve animal by tag/name** — always scope to ranch to avoid tag collisions across ranches:

```sql
-- By exact ear tag:
WHERE ear_tag_id = 'TAG' AND ranch_uuid = 'RANCH_UUID' AND is_deleted = false LIMIT 1

-- By name (fuzzy):
WHERE LOWER(name) LIKE LOWER('%NAME%') AND ranch_uuid = 'RANCH_UUID' AND is_deleted = false LIMIT 10
```

Cache resolved UUIDs in conversation — don't re-resolve the same entity twice.

---

## Query Decision Guide

Use this to choose the right approach before writing SQL.

### Single animal vs. ranch-wide

| Scope                  | Approach                                                                      |
| ---------------------- | ----------------------------------------------------------------------------- |
| One specific animal    | Filter by `livestock_uuid` + `is_deleted = false`                             |
| All animals in a ranch | Filter by `ranch_uuid` + `is_deleted = false` + `livestock_status = 'ACTIVE'` |
| Cross-ranch (all data) | No `ranch_uuid` filter — expensive, always add `LIMIT`                        |

### Point-in-time vs. historical

| Need                                       | Approach                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Latest single value (e.g., current weight) | `ORDER BY recorded_at DESC LIMIT 1` on filtered animal                                                     |
| Latest per animal across many animals      | `ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) = 1` via inline view or QUALIFY |
| Full history for one animal                | All records `ORDER BY recorded_at ASC`                                                                     |
| Trend / change over time                   | CTE with first + last records, compute delta                                                               |

### Aggregates vs. lookups

| Need                             | Approach                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| Count, sum, avg, min, max        | SQL aggregate functions — never post-process in code       |
| Distribution (e.g., BCS buckets) | `GROUP BY` + `COUNT(*)`                                    |
| Ranked list (top gainers, etc.)  | Window function + `ORDER BY`                               |
| Missing data (animals without X) | `NOT IN (SELECT ...)` or `LEFT JOIN ... WHERE ... IS NULL` |

---

## BQ CLI Syntax & Quoting

### Standard invocation

```bash
bq query \
  --project_id=frontiersmarketplace \
  --use_legacy_sql=false \
  --format=json \
  --max_rows=1000 \
  'YOUR SQL HERE'
```

**Always include:**

- `--project_id=frontiersmarketplace` — explicit project prevents auth errors
- `--use_legacy_sql=false` — always use standard SQL (legacy SQL has different syntax)
- `--format=json` — returns structured output, not ASCII table
- `--max_rows=N` — BQ default is 100 rows; set explicitly to avoid silent truncation

### Shell quoting rules

The SQL string is wrapped in single quotes in bash. **Single quotes cannot appear inside a single-quoted shell string.**

**For simple queries (no literal single-quoted string values in SQL):**

```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json \
  'SELECT uuid, ranch_name FROM `frontiersmarketplace.public.ranch` WHERE state_short = "TX"'
```

Note: use **double quotes** for string literals inside the SQL when the outer bash string uses single quotes.

**For queries with single-quoted SQL string values (safer pattern):**

```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json \
  "SELECT uuid, ranch_name FROM \`frontiersmarketplace.public.ranch\` WHERE state_short = 'TX'"
```

Note: backticks must be escaped as `\`` when using double-quoted bash string.

**Preferred: heredoc for multi-line or complex SQL — cleanest, no escaping needed:**

```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json --max_rows=100 \
  "$(cat <<'ENDSQL'
SELECT
  l.ear_tag_id,
  l.name,
  w.weight
FROM `frontiersmarketplace.public.livestock` l
JOIN `frontiersmarketplace.public.weight_record` w ON w.livestock_uuid = l.uuid
WHERE l.ranch_uuid = 'RANCH_UUID'
  AND l.is_deleted = false
  AND w.is_deleted = false
ORDER BY w.recorded_at DESC
LIMIT 50
ENDSQL
)"
```

### Dry-run before expensive queries

Use `--dry_run` to validate syntax and estimate bytes scanned **without executing**:

```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --dry_run \
  'SELECT COUNT(*) FROM `frontiersmarketplace.public.livestock`'
```

Use this before any query with no `ranch_uuid` filter or with broad date ranges.

### LIMIT vs. --max_rows

Both are needed and serve different purposes:

- `LIMIT N` in SQL: database-side, runs before data is returned
- `--max_rows N` in bq CLI: client-side cap on rows BQ will display/return

Always set both. If `--max_rows` < `LIMIT`, you'll get silent truncation. Make `--max_rows` ≥ `LIMIT`.

---

## Type Rules & Common Pitfalls

### BOOLEAN (`is_deleted`, etc.)

```sql
-- Correct:
WHERE is_deleted = false
WHERE is_deleted = true

-- WRONG — will error or silently mismatch:
WHERE is_deleted = 0
WHERE is_deleted = 'false'
WHERE is_deleted IS NULL   -- only if checking for NULLs specifically
```

### STRING UUIDs

All PKs and FKs are UUID strings. Always quote them:

```sql
WHERE ranch_uuid = 'a1b2c3d4-...'   -- correct
WHERE ranch_uuid = a1b2c3d4-...      -- WRONG — syntax error
```

### TIMESTAMP vs. DATE

- `recorded_at`, `created_at`, `updated_at`, `administered_at` are TIMESTAMP columns
- Compare with full ISO strings or cast: `DATE(recorded_at) >= DATE '2024-01-01'`
- Use `DATE_DIFF(DATE(ts1), DATE(ts2), DAY)` for day differences
- Use `CURRENT_DATE()` and `CURRENT_TIMESTAMP()` for "now"
- To filter last 30 days: `WHERE recorded_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)`

### FLOAT64 vs. INT64 (BCS score, weight)

- BCS `score` is FLOAT64 in schema — cast when grouping by score value:
  ```sql
  SELECT CAST(score AS INT64) as bcs_score, COUNT(*) as count
  ```
- `weight` is FLOAT64 — round for display: `ROUND(AVG(weight), 1)`
- Division: always use `SAFE_DIVIDE(numerator, denominator)` — returns NULL instead of error on divide-by-zero

### NULL handling

- Nullable FK columns: `sire_uuid`, `dam_uuid`, `group_uuid`, `land_uuid`, `name` — always use LEFT JOIN for these
- INNER JOIN on nullable FK **silently drops** animals without that FK set
- Display NULLs gracefully: `COALESCE(name, ear_tag_id, 'Unknown')` for animal display names
- `COUNT(*)` counts all rows including NULLs; `COUNT(column)` skips NULLs

### Reserved words

`group` is a SQL reserved word. Always backtick it in BigQuery:

```sql
FROM `frontiersmarketplace.public.group` g   -- correct
FROM frontiersmarketplace.public.group g     -- WRONG — syntax error
```

### LIKE vs. = for string matching

- Exact match: `WHERE ear_tag_id = 'TAG123'`
- Fuzzy match: `WHERE LOWER(ranch_name) LIKE LOWER('%search%')`
- Do NOT use `=` for fuzzy matching or LIKE for exact matching on UUID columns

---

## "Latest Record" Patterns

This is the most common query structure for record tables. Three valid approaches — choose based on context.

### Pattern A: Single animal, single latest record (simplest)

Use when you need the most recent record for **one specific animal**:

```sql
SELECT weight, weight_unit, recorded_at
FROM `frontiersmarketplace.public.weight_record`
WHERE livestock_uuid = 'LIVESTOCK_UUID' AND is_deleted = false
ORDER BY recorded_at DESC
LIMIT 1
```

### Pattern B: QUALIFY with ROW_NUMBER (many animals, clean syntax)

Use when you need the latest record for **each animal in a set** — most readable:

```sql
SELECT livestock_uuid, weight, weight_unit, recorded_at
FROM `frontiersmarketplace.public.weight_record`
WHERE ranch_uuid = 'RANCH_UUID' AND is_deleted = false
QUALIFY ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) = 1
```

### Pattern C: Inline view with ROW_NUMBER (for JOINs)

Use when you need to **JOIN** the latest record to another table:

```sql
SELECT l.ear_tag_id, w.weight, w.recorded_at
FROM `frontiersmarketplace.public.livestock` l
JOIN (
  SELECT livestock_uuid, weight, recorded_at,
    ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) as rn
  FROM `frontiersmarketplace.public.weight_record`
  WHERE is_deleted = false
) w ON w.livestock_uuid = l.uuid AND w.rn = 1
WHERE l.ranch_uuid = 'RANCH_UUID' AND l.is_deleted = false AND l.livestock_status = 'ACTIVE'
```

**Do NOT use correlated MAX subquery for "latest" when joining** — it's less efficient and harder to extend to multiple columns.

---

## Date & Time Handling

```sql
-- Filter by specific date range:
WHERE recorded_at BETWEEN '2024-01-01' AND '2024-12-31'
-- OR equivalently:
WHERE recorded_at >= '2024-01-01' AND recorded_at < '2025-01-01'

-- Last N days:
WHERE recorded_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)

-- This year:
WHERE EXTRACT(YEAR FROM recorded_at) = EXTRACT(YEAR FROM CURRENT_DATE())

-- Day difference between two timestamps:
DATE_DIFF(DATE(ts_end), DATE(ts_start), DAY)

-- Format timestamp for display:
FORMAT_TIMESTAMP('%Y-%m-%d', recorded_at)

-- Convert to date only:
DATE(recorded_at)
```

**Key rule:** `recorded_at` = when the event happened in the real world. `created_at` = when the DB row was inserted. Always sort and filter on `recorded_at` for chronological analysis. Use `created_at` only when explicitly asking about when a record was entered into the system.

---

## Query Rules

- **Never `SELECT *`** — specify only needed columns
- **Always `LIMIT`** — 50 for lists, 1 for details/latest, 10 for exploration, 100+ only for export
- **Filter by `ranch_uuid` first** — critical for scan performance; it's the universal partition key
- **Aggregate server-side** — use SQL `COUNT/AVG/MAX/MIN/SUM`, never post-process in code
- **LEFT JOIN for nullable FKs** — `group_uuid`, `land_uuid`, `sire_uuid`, `dam_uuid` can be NULL
- **INNER JOIN only** when you know both sides always have a match (e.g., `weight_record → livestock`)
- **`--dry_run`** before queries with no `ranch_uuid` filter or broad date ranges
- **See `references/query-patterns.md`** for ready-to-use SQL templates
- **See `references/schema.md`** for full table structures

---

## Execution

```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json --max_rows=1000 'SQL'
```

For multi-line SQL, use heredoc syntax (see BQ CLI Syntax section above).

### Error Recovery (try silently before telling the user)

| Error message                                    | Cause                                               | Fix                                                                             |
| ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Not found: Table`                               | Table name wrong or not in dataset                  | Check schema cache; re-run discovery if stale                                   |
| `Unrecognized name: <column>`                    | Column doesn't exist                                | Check schema cache for actual column name                                       |
| `Syntax error: Expected end of input but got...` | Quoting issue in bash or reserved word              | Switch to heredoc quoting; backtick reserved words like `` `group` ``           |
| `Cannot read field 'X' of type Y as Z`           | Type mismatch in comparison                         | Check column type in schema; use `CAST()` or correct literal format             |
| `Resources exceeded`                             | Query too broad                                     | Add `ranch_uuid` filter, tighten date range, reduce `LIMIT`                     |
| `Division by zero`                               | Using `/` operator                                  | Replace with `SAFE_DIVIDE(a, b)`                                                |
| `No matching signature for function IF`          | Wrong function for BigQuery                         | Use `IF(cond, true_val, false_val)` or `CASE WHEN`                              |
| `Table name must be qualified`                   | Missing dataset/project prefix                      | Use full path: `` `frontiersmarketplace.public.table_name` ``                   |
| Result is 0 or empty when data is expected       | Missing `is_deleted = false` or wrong status filter | Verify filters; try removing `livestock_status` filter to check deleted records |
| Count is inflated                                | Forgot `is_deleted = false` on one side of JOIN     | Apply filter on all tables in the query                                         |

---

## Common Mistake Patterns

These are mistakes to actively avoid:

**1. Forgetting `is_deleted` on joined tables**

```sql
-- WRONG: only filters livestock, not weight_record
WHERE l.is_deleted = false

-- CORRECT: filter both sides
WHERE l.is_deleted = false AND w.is_deleted = false
```

**2. Using INNER JOIN on optional relationships**

```sql
-- WRONG: drops animals with no group assigned
JOIN `frontiersmarketplace.public.group` g ON g.uuid = l.group_uuid

-- CORRECT:
LEFT JOIN `frontiersmarketplace.public.group` g ON g.uuid = l.group_uuid AND g.is_deleted = false
```

**3. Querying `recorded_at` without DATE() when comparing to date strings**

```sql
-- RISKY: depends on implicit casting
WHERE recorded_at = '2024-01-15'

-- CORRECT:
WHERE DATE(recorded_at) = DATE '2024-01-15'
```

**4. Not scoping ear tag lookup to ranch**

```sql
-- WRONG: ear tags are NOT globally unique — multiple ranches can use '001'
WHERE ear_tag_id = '001'

-- CORRECT:
WHERE ear_tag_id = '001' AND ranch_uuid = 'RANCH_UUID'
```

**5. Using `group` without backticks**

```sql
-- WRONG — syntax error (reserved word):
FROM frontiersmarketplace.public.group

-- CORRECT:
FROM `frontiersmarketplace.public.group`
```

**6. Using livestock_status = 'ACTIVE' without is_deleted = false**

```sql
-- WRONG: status and is_deleted are independent fields
WHERE livestock_status = 'ACTIVE'

-- CORRECT: both are required for "current active herd"
WHERE is_deleted = false AND livestock_status = 'ACTIVE'
```

**7. Silently truncated results**

```sql
-- WRONG: --max_rows defaults to 100 but LIMIT is 500
bq query --format=json 'SELECT ... LIMIT 500'

-- CORRECT: match --max_rows to your LIMIT
bq query --format=json --max_rows=500 'SELECT ... LIMIT 500'
```

---

## Learning

When the user confirms a result is correct ("yes, exactly", "that's right", "perfect"):

- Save the query pattern to `memory/query-patterns.md` with a note of what it solved
- This avoids re-discovering the same pattern next session

---

## Response

- Present data cleanly — no raw JSON, no query details, no file paths
- Include context: "Ranch X has 847 active cattle" beats a bare number
- Summarize large results (200+ rows → key stats, not full list)
- Format numbers: `1,234` not `1234`; weights: `847 lbs` not `847`
- File exports → write to `results/` inside this skill folder
- See AGENTS.md → Platform Formatting for Slack/Discord/WhatsApp differences
