---
name: alloydb-sync
description: >
  Query ranch, livestock, and cattle record data from Google BigQuery 'alloydb_sync' dataset.
  Use when the user asks about ranches, cattle, livestock counts, weight records, BCS scores,
  vaccination history, notes, groups, pastures, or any Frontiers Market operational data.
---

# AlloyDB Sync — Data Gathering Skill

## Purpose

Fast, accurate retrieval of ranch and livestock data from the `alloydb_sync` BigQuery dataset. This is the bot's primary data skill for answering questions about ranches, cattle, records, and operational insights.

## Workflow

Every data request follows this sequence:

1. **Acknowledge** — Immediately tell the user you're looking into it (e.g. "Checking the database..." / "Pulling that data for you..."). Do this BEFORE running any queries.
2. **Resolve entities** — Map ranch names → UUIDs, animal names/tags → livestock UUIDs (see Intent Resolution below).
3. **Build & execute query** — Use cached schema, apply soft-delete filters, optimize for speed (see Query Optimization).
4. **Format for channel** — Adapt the response to the active platform. See Response Formatting below.
5. **Present results** — Concise summary with context. Offer follow-ups when relevant.
6. **On failure** — Report errors clearly to the user with what went wrong and a suggested next step. Never fail silently or show raw error output.

## Soft Deletes — Critical Default Behavior

**Almost every table in this dataset uses an `is_deleted` (BOOLEAN) column for soft deletes.** This is the single most important filtering rule.

### The Rule

> **Always include `WHERE is_deleted = false` unless the user explicitly asks about deleted/archived records.**

This applies to:
- All `public_*` entity tables (`public_livestock`, `public_group`, `public_land`)
- All `public_*_record` event tables (`public_weight_record`, `public_bcs_record`, `public_vaccination_record`, `public_note_record`)
- Any new table discovered via schema — if it has an `is_deleted` column, filter it

### Why this matters

Rows with `is_deleted = true` are soft-deleted records that were removed in the Frontiers Market application. Including them produces inflated counts, ghost animals, orphaned records, and wrong answers. The data is kept for audit/history purposes only.

### When to include deleted records

Only if the user explicitly asks:
- "Show me deleted cattle"
- "Include archived records"
- "How many animals were removed?"

In those cases, either omit the filter or use `WHERE is_deleted = true` to show only deleted records.

### Combining with status filters

For livestock queries, you often want both filters:
```sql
WHERE is_deleted = false AND livestock_status = 'ACTIVE'
```
- `is_deleted = false` — excludes soft-deleted rows (always apply)
- `livestock_status = 'ACTIVE'` — excludes sold, deceased, transferred animals (apply when user wants current herd only)

If the user asks "how many cattle does this ranch have", use both. If they ask "how many cattle have been sold", use `is_deleted = false AND livestock_status = 'SOLD'`.

### In JOINs

Apply `is_deleted = false` on **both sides** of a JOIN when both tables support it:
```sql
FROM `alloydb_sync.public_livestock` l
JOIN `alloydb_sync.public_weight_record` w ON w.livestock_uuid = l.uuid
WHERE l.is_deleted = false AND w.is_deleted = false
```

---

## Schema Memory System

**You must learn table structures once, store them in memory, and reuse that knowledge.** Do not re-discover schema on every query — go straight to writing queries using your cached schema.

### First interaction (no cached schema)

Check if `memory/bq-schema.md` exists. If not, run the discovery query:

```bash
bq query --use_legacy_sql=false --format=json --max_rows=5000 \
  'SELECT table_name, column_name, data_type FROM alloydb_sync.INFORMATION_SCHEMA.COLUMNS ORDER BY table_name, ordinal_position'
```

Then write the results to your memory file:

```
memory/bq-schema.md
```

Format it as a quick-reference table map, noting which tables have `is_deleted`:

```markdown
# BQ Schema Cache
## Last updated: <date>

### public_livestock
uuid (STRING), ranch_uuid (STRING), ear_tag_id (STRING), name (STRING), livestock_status (STRING), sex (STRING), breed (STRING), date_of_birth (DATE), sire_uuid (STRING), dam_uuid (STRING), group_uuid (STRING), land_uuid (STRING), is_deleted (BOOLEAN), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: yes**

### public_weight_record
uuid (STRING), livestock_uuid (STRING), ranch_uuid (STRING), weight (FLOAT64), weight_unit (STRING), recorded_at (TIMESTAMP), notes (STRING), is_deleted (BOOLEAN), created_at (TIMESTAMP)
**has is_deleted: yes**

### livestock_denorm
ranch_name (STRING), ranch_uuid (STRING), uuid (STRING), ear_tag_id (STRING), ...
**has is_deleted: check**
...
```

### Subsequent interactions — go straight to querying

1. Read `memory/bq-schema.md` at the start of the conversation
2. **Use the cached schema directly to build queries** — do not run INFORMATION_SCHEMA queries before answering the user
3. If a query fails with "table not found" or "column not found", re-run discovery and update the cache
4. If the user asks about a table you don't recognize, check the cache first, then discover only if missing

### When to refresh the schema cache

- If you get a schema-related error (table/column not found)
- If the user says "tables changed", "new columns", or "schema updated"
- If the cache is older than 7 days (check the "Last updated" date)
- After a refresh, update the `Last updated` date in the memory file
- **Never refresh mid-conversation just to be safe — trust your cache**

### Why memory matters

Schema discovery queries scan INFORMATION_SCHEMA which adds latency and cost. By caching the schema in memory, you can answer user questions in a single round-trip (one data query) instead of two (schema discovery + data query). This makes the bot feel significantly faster and more responsive.

## Understanding User Intent

Map what the user says to the right table and query pattern. Think before querying.

### Intent Resolution Flow

```
User question
  → Identify the ENTITY (ranch? animal? record type?)
  → Identify the SCOPE (one animal? all in ranch? comparison?)
  → Identify the METRIC (count? latest? history? trend?)
  → Pick the smallest query that answers it
```

### Common Intent Patterns

| User says | Entity | Table(s) | Strategy |
|-----------|--------|-----------|----------|
| "how many cattle in [ranch]" | livestock | `public_livestock` | COUNT with ranch_uuid filter |
| "show me [ranch name]'s cattle" | livestock | `livestock_denorm` | List with ranch_name filter (denorm is faster for name lookups) |
| "weight history for tag #123" | weight records | `public_weight_record` JOIN `public_livestock` | Filter by ear_tag_id, ORDER BY date |
| "latest BCS for [animal]" | BCS records | `public_bcs_record` | Filter + ORDER BY date DESC LIMIT 1 |
| "vaccination records" | vax records | `public_vaccination_record` | Filter by livestock or ranch scope |
| "notes on [animal]" | note records | `public_note_record` | Filter by livestock_uuid |
| "which pasture is [animal] in" | land/location | `public_land` or livestock location fields | Check livestock current_land or join |
| "groups in [ranch]" | groups | `public_group` | Filter by ranch_uuid |
| "ranch overview / summary" | multi | `public_ranch` + `public_livestock` counts | Aggregate query |
| "where is [ranch]" | ranch | `public_ranch` | Location/address lookup |
| "ranch info / details" | ranch | `public_ranch` | Direct metadata query |
| "ranches in Texas" | ranch | `public_ranch` | Filter by state_short |

### Resolving Ranch Identity

Users will say ranch names, not UUIDs. **Use `public_ranch` as the primary source** for ranch resolution:

```sql
SELECT uuid, ranch_name, city, state_short
FROM `alloydb_sync.public_ranch`
WHERE LOWER(ranch_name) LIKE LOWER('%user_input%')
LIMIT 5
```

This is preferred over `livestock_denorm` because:
- `public_ranch` is the authoritative ranch table with full metadata (location, owner, operation type)
- It works even for ranches with zero livestock
- It returns ranch-specific fields (address, coordinates) that denorm doesn't have

If you already know the ranch UUID from context (prior conversation, memory), skip this step.

**Cache ranch mappings in conversation context** — don't re-resolve the same ranch twice.

### Resolving Animal Identity

Users refer to cattle by ear tag, name, or description. Resolution order:

1. **Ear tag** (most common): `WHERE ear_tag_id = 'TAG'` on `public_livestock`
2. **Name**: `WHERE LOWER(name) LIKE LOWER('%name%')` on `public_livestock`
3. **UUID** (rare, from prior context): direct lookup

Always scope animal lookups to a ranch when possible (faster, avoids cross-ranch collisions on common tag numbers).

## Query Optimization Rules

**Every query must be fast. Follow these rules strictly.**

### 1. Never SELECT *

Always specify only the columns you need. This massively reduces data scanned and cost.

```sql
-- BAD
SELECT * FROM `alloydb_sync.public_livestock` WHERE ranch_uuid = '...'

-- GOOD
SELECT uuid, ear_tag_id, name, livestock_status
FROM `alloydb_sync.public_livestock`
WHERE ranch_uuid = '...'
```

### 2. Always use LIMIT

Unless the user explicitly needs all rows or you're doing COUNT/aggregation:

- List queries: `LIMIT 50` default, adjust if user asks for more
- Detail queries: `LIMIT 1`
- Exploration: `LIMIT 10`

### 3. Filter early, filter tight

- **Always include `is_deleted = false`** — this is mandatory on every table that has the column (see Soft Deletes section above). Do not treat this as optional.
- Always include `ranch_uuid` when scope is a single ranch
- Always include `livestock_uuid` when scope is a single animal
- Add `AND livestock_status = 'ACTIVE'` when the user wants current/active livestock (ask if ambiguous)

### 4. Prefer denormalized views

Use `livestock_denorm` over joining `public_livestock` + ranch lookups when you need ranch names alongside livestock data. The view exists specifically for this.

### 5. Use aggregations server-side

Don't fetch raw rows and count in your head. Use SQL:

```sql
-- Counts, averages, min/max, latest
SELECT COUNT(*) as total, AVG(weight) as avg_weight
FROM `alloydb_sync.public_weight_record`
WHERE livestock_uuid = '...'
```

### 6. Batch related lookups

If you need data from multiple tables for the same answer, consider whether a single JOIN is faster than multiple round-trips:

```sql
-- Single query for animal + latest weight + latest BCS
SELECT l.ear_tag_id, l.name, l.livestock_status,
  w.weight as latest_weight, w.recorded_at as weight_date,
  b.score as latest_bcs, b.recorded_at as bcs_date
FROM `alloydb_sync.public_livestock` l
LEFT JOIN (
  SELECT livestock_uuid, weight, recorded_at,
    ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) as rn
  FROM `alloydb_sync.public_weight_record`
) w ON w.livestock_uuid = l.uuid AND w.rn = 1
LEFT JOIN (
  SELECT livestock_uuid, score, recorded_at,
    ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) as rn
  FROM `alloydb_sync.public_bcs_record`
) b ON b.livestock_uuid = l.uuid AND b.rn = 1
WHERE l.ranch_uuid = 'RANCH_UUID'
LIMIT 50
```

BUT — only JOIN when needed. A simple count doesn't need a join.

## Execution

All queries run via the `bq` CLI:

```bash
bq query --use_legacy_sql=false --format=json --max_rows=1000 'YOUR_SQL_HERE'
```

### Flags

| Flag | Purpose |
|------|---------|
| `--use_legacy_sql=false` | **Always required.** Uses standard SQL. |
| `--format=json` | Structured output, easy to parse and present. |
| `--max_rows=N` | Safety limit. Default 1000. Use lower for list queries. |
| `--dry_run` | Use to validate a query without executing (checks schema, estimates bytes scanned). |

### Error Handling

Internal recovery (try before telling the user):
- **"Not found: Table"** → table name wrong. Check schema cache, re-discover if needed.
- **"Unrecognized name"** → column doesn't exist. Check schema cache.
- **"Resources exceeded"** → query too broad. Add tighter filters or reduce scope.
- **Timeout** → add LIMIT, filter by ranch_uuid, select fewer columns.

User-facing reporting (always communicate if recovery fails):
- "I couldn't find a ranch matching 'X'. Could you double-check the name?"
- "That query returned no results. The animal might be archived — want me to check deleted records?"
- "The database query took too long. Let me try narrowing the search."

Never show raw error messages or fail silently.

## Response Formatting

### General Rules

- **Be concise.** Present data cleanly — no raw JSON dumps.
- **Include context.** "Ranch X has 847 active cattle" beats a bare number.
- **Summarize large results.** 200 rows → summarize key stats, don't list everything.
- **Offer follow-ups.** "Want me to break this down by group?" or "I can pull weight trends for these."
- **Cite what you queried.** Briefly mention what data source you used so the user trusts the answer.
- **Format numbers.** Use `1,234` not `1234`, `$45.20` not `45.2`.

### Channel Formatting

Adapt output to the active platform. Wrong formatting produces broken text.

- **Slack**: `*bold*` for section titles (NOT `**` or `#`), `_italic_` for secondary info, code blocks for tabular data, `<url|label>` for links. No markdown tables.
- **Discord**: `**bold**` for headers, code blocks for tables (markdown tables render poorly), max 2000 chars — split or offer PDF for large datasets.
- **WhatsApp**: `*bold*` for emphasis, no headers or tables, keep short and conversational, line breaks for structure.
- **API / Control UI**: Full standard markdown works.

Full syntax reference: `AGENTS.md` → "Platform Formatting" section.

### Data Exports

If the user asks for a CSV, JSON, or any file export, write the output to the `results/` directory inside this skill folder. Create the directory if it doesn't exist. Only write files elsewhere if the user explicitly requests a specific path.

## Schema Reference

See [references/schema.md](references/schema.md) for known table structures.

**Remember:** The schema reference is a starting point. Your `memory/bq-schema.md` cache (built from INFORMATION_SCHEMA) is the authoritative, live source of truth.
