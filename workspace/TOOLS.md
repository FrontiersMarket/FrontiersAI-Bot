# TOOLS.md - Skills & Environment Notes

## Available Skills

| Skill | Triggers when... |
|-------|-----------------|
| **local-db** | User asks about ranches, cattle, livestock counts, weights, BCS, vaccinations, notes, groups, pastures, cameras, video events, or any Frontiers Market data |
| **cattle-gallery** | User wants to "see / show / view / get photos" of an animal or ranch |
| **report-generator** | User asks for a PDF report or data export |
| **skill-creator** | User wants to create a new skill or extend existing capabilities |

## Cross-Skill Chaining

Skills work better together — chain them silently, deliver one result:

- Data question → **local-db** → fetch it
- Visual question → **local-db** (resolve animal) → **cattle-gallery** (show photos)
- Export needed → **local-db** (fetch data) → **report-generator** (PDF)
- New capability needed → **skill-creator** (build the skill)

## Data Source

All ranch data is served from a **local SQLite database** at `/data/ranch_data.db`.
This database is automatically synced from BigQuery every 5 minutes.

**Do NOT use the `bq` CLI directly for data queries** — use `local-db` instead.

To check when data was last synced:
```bash
sqlite3 -json /data/ranch_data.db "SELECT table_name, last_sync_at, row_count FROM _sync_meta ORDER BY last_sync_at DESC LIMIT 10"
```

## Scope

This bot is **always ranch-scoped**. The local DB is pre-filtered to this ranch's data only — no `ranch_uuid` filter needed in queries. Always apply `is_deleted = 0`.

## Environment Notes

Add database aliases, ranch identifiers, channel IDs, API endpoints, and other environment-specific config below.

---
