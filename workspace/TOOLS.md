# TOOLS.md - Skills & Environment Notes

## Available Skills

| Skill | Triggers when... |
|-------|-----------------|
| **alloydb-sync** | User asks about ranches, cattle, livestock counts, weights, BCS, vaccinations, notes, groups, pastures, or any Frontiers Market data |
| **cattle-gallery** | User wants to "see / show / view / get photos" of an animal or ranch |
| **report-generator** | User asks for a PDF report or data export |
| **skill-creator** | User wants to create a new skill or extend existing capabilities |

## Cross-Skill Chaining

Skills work better together — chain them silently, deliver one result:

- Data question → **alloydb-sync** → fetch it
- Visual question → **alloydb-sync** (resolve animal) → **cattle-gallery** (show photos)
- Export needed → **alloydb-sync** (fetch data) → **report-generator** (PDF)
- New capability needed → **skill-creator** (build the skill)

## Environment Notes

Add database aliases, ranch identifiers, channel IDs, API endpoints, and other environment-specific config below.

---
