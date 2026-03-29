# TOOLS.md - Skills & Environment Notes

## Available Skills

| Skill | Triggers when... |
|-------|-----------------|
| **local-db** | User asks about ranches, cattle, livestock counts, weights, BCS, vaccinations, notes, groups, pastures, cameras, ML detection events, pen weight trends, or any Frontiers Market data |
| **cattle-gallery** | User wants to "see / show / view / get photos" of an animal or ranch |
| **report-generator** | User asks for a PDF report or data export |
| **python-dataviz** | User asks for a chart, graph, plot, visualization, or any visual representation of data |
| **shorten** | ALWAYS use before sharing any URL — mandatory for video URLs, recommended for any long URL |
| **skill-creator** | User wants to create a new skill or extend existing capabilities |
| **clawdhub** | User asks to search, browse, install, update, or publish skills from ClawhHub — always available from startup |

## Cross-Skill Chaining

Skills work better together — chain them silently, deliver one result:

- Data question → **local-db** → fetch it
- Visual question → **local-db** (resolve animal) → **cattle-gallery** (show photos)
- Chart/graph request → **local-db** (fetch data) → **python-dataviz** (generate + deliver chart inline)
- Export needed → **local-db** (fetch data) → **report-generator** (PDF)
- Detection events request → **local-db** (query `confirmed_events` joined to `cameras` on `camera_name`) → present each event with description, camera name, date/time, confidence, severity
- New capability needed → **skill-creator** (build the skill) or **clawdhub** (install from registry)

## ClawhHub Skill Management

The **clawdhub** skill is always available from startup. Use `clawdhub` CLI to manage skills from the ClawhHub registry.

**Confirmation required — NEVER install or update without explicit user approval:**

1. User requests a new skill → search ClawhHub: `clawdhub search "<query>"`
2. Present results (name, description, version) and ask: *"Found `<slug>` — install it?"*
3. Only run `clawdhub install <slug>` after the user confirms with yes/ok/go ahead
4. Same rule for updates: describe what will change, get confirmation, then run `clawdhub update <slug>`

**Search and listing are always safe — no confirmation needed:**
- `clawdhub search "query"` — find skills
- `clawdhub list` — show installed skills

**Always require confirmation before:**
- `clawdhub install <slug>` — installs a new skill
- `clawdhub update <slug>` / `clawdhub update --all` — upgrades existing skills
- `clawdhub publish ...` — publishes to registry

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
