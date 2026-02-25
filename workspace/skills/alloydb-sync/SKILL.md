---
name: alloydb-sync
description: >
  Query ranch, livestock, and cattle record data from Google BigQuery 'frontiersmarketplace.public' dataset.
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

## Soft Delete Rule — ALWAYS APPLY

Every table with `is_deleted` must include `WHERE is_deleted = false` by default.
Only omit if the user explicitly asks about deleted/archived records.

Apply on **both sides** of JOINs: `WHERE l.is_deleted = false AND w.is_deleted = false`

For livestock, combine both filters when user wants current herd:
```sql
WHERE is_deleted = false AND livestock_status = 'ACTIVE'
```

`ranch` table has **no** `is_deleted` column.

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

## Intent → Table Mapping

| User asks | Table(s) |
|-----------|----------|
| cattle count / herd | `livestock` |
| ranch info / location | `ranch` |
| cattle with ranch names | `livestock_denorm` |
| weight / gain | `weight_record` |
| BCS scores | `bcs_record` |
| vaccinations | `vaccination_record` |
| notes / observations | `note_record` |
| groups / herds | `group` |
| pastures / land | `land` |

**Resolve ranch by name** (`ranch` is the authoritative source — has location and metadata):
```sql
SELECT uuid, ranch_name, city, state_short
FROM `frontiersmarketplace.public.ranch`
WHERE LOWER(ranch_name) LIKE LOWER('%input%') LIMIT 5
```

**Resolve animal by tag/name** (scope to ranch to avoid collisions):
```sql
WHERE ear_tag_id = 'TAG' AND ranch_uuid = 'RANCH_UUID' AND is_deleted = false
```

Cache resolved UUIDs in conversation — don't re-resolve the same entity twice.

## Query Rules

- **Never SELECT \*** — specify only needed columns
- **Always LIMIT** — 50 for lists, 1 for details, 10 for exploration
- **Filter by `ranch_uuid`** when in ranch scope — critical for performance
- **Use `livestock_denorm`** when you need ranch names alongside livestock data (avoids join)
- **Aggregate server-side** — use SQL COUNT/AVG/MAX, not post-processing
- **See `references/query-patterns.md`** for ready-to-use SQL templates
- **See `references/schema.md`** for table structures

## Execution

```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json --max_rows=1000 'SQL'
```

Always include `--project_id=frontiersmarketplace` and `--use_legacy_sql=false`.
Use `--dry_run` to validate before executing expensive queries.

**Error recovery (try before telling the user):**
- "Not found: Table" → check schema cache, re-discover if needed
- "Unrecognized name" → column doesn't exist, check cache
- "Resources exceeded" → add tighter filters or reduce scope

## Learning

When the user confirms a result is correct ("yes, exactly", "that's right", "perfect"):
- Save the query pattern to `memory/query-patterns.md` with a note of what it solved
- This avoids re-discovering the same pattern next session

## Response

- Present data cleanly — no raw JSON, no query details, no file paths
- Include context: "Ranch X has 847 active cattle" beats a bare number
- Summarize large results (200+ rows → key stats, not full list)
- Format numbers: `1,234` not `1234`
- File exports → write to `results/` inside this skill folder
- See AGENTS.md → Platform Formatting for Slack/Discord/WhatsApp differences
