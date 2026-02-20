# AlloyDB Sync Schema Reference

Dataset: `alloydb_sync`

> **Note:** This is a baseline reference. The bot should discover the actual live schema via
> `INFORMATION_SCHEMA.COLUMNS` and cache it in `memory/bq-schema.md`. If a table or column
> listed here doesn't exist in your environment, trust the live discovery over this file.

---

## Core Entity Tables

### public_ranch

The ranch/operation table. **Use this as the authoritative source for ranch identity, location, and metadata.** This table does NOT have `is_deleted` — all rows are live.

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Ranch identifier (PK) — this is the `ranch_uuid` FK used everywhere |
| organization_uuid | STRING | FK to parent organization |
| owner_uuid | STRING | FK to ranch owner/user |
| ranch_name | STRING | Display name (user-facing) |
| operation_type | JSON | Type of operation (cow-calf, stocker, feedlot, etc.) |
| address | STRING | Full formatted address |
| city | STRING | City |
| state | STRING | Full state name |
| state_short | STRING | State abbreviation (e.g., `TX`, `MT`) |
| zip_code | STRING | ZIP/postal code |
| street_address | STRING | Street address |
| street_number | STRING | Street number |
| lat | FLOAT | Latitude |
| lng | FLOAT | Longitude |
| website_url | STRING | Ranch website (nullable) |
| created_at | TIMESTAMP | Record creation |
| updated_at | TIMESTAMP | Last modification |

**Common filters:**
- `WHERE uuid = 'RANCH_UUID'` — single ranch lookup
- `WHERE LOWER(ranch_name) LIKE LOWER('%search%')` — fuzzy name search
- `WHERE state_short = 'TX'` — ranches by state

**Note:** No `is_deleted` column on this table — all rows are active.

### public_livestock

The primary table for individual cattle/animal records. **Most queries start here.**

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Unique animal identifier (PK) |
| ranch_uuid | STRING | FK to ranch |
| ear_tag_id | STRING | Physical ear tag number (user-facing ID) |
| name | STRING | Animal name (optional, not all animals are named) |
| livestock_status | STRING | Current status: `ACTIVE`, `SOLD`, `DECEASED`, `TRANSFERRED`, etc. |
| sex | STRING | `MALE`, `FEMALE`, `UNKNOWN` |
| breed | STRING | Breed name/code |
| date_of_birth | DATE/TIMESTAMP | Birth date |
| sire_uuid | STRING | Father's livestock UUID (nullable) |
| dam_uuid | STRING | Mother's livestock UUID (nullable) |
| group_uuid | STRING | Current group/herd assignment |
| land_uuid | STRING | Current pasture/land assignment |
| is_deleted | BOOLEAN | Soft delete flag — filter with `= false` for active data |
| created_at | TIMESTAMP | Record creation |
| updated_at | TIMESTAMP | Last modification |

**Common filters:**
- `WHERE ranch_uuid = '...' AND is_deleted = false` — active cattle in a ranch
- `WHERE livestock_status = 'ACTIVE'` — only currently active animals
- `WHERE ear_tag_id = '...' AND ranch_uuid = '...'` — specific animal by tag (scope to ranch to avoid collisions)

### public_group

Groups or herds within a ranch. Animals are assigned to groups for organization.

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Group identifier (PK) |
| ranch_uuid | STRING | FK to ranch |
| name | STRING | Group name (e.g., "Breeding Heifers", "Bull Lot") |
| description | STRING | Optional description |
| is_deleted | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | Record creation |
| updated_at | TIMESTAMP | Last modification |

### public_land

Land parcels, pastures, and paddocks associated with a ranch.

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Land identifier (PK) |
| ranch_uuid | STRING | FK to ranch |
| name | STRING | Pasture/paddock name |
| area | STRING | Size/area info |
| is_deleted | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | Record creation |
| updated_at | TIMESTAMP | Last modification |

---

## Record Tables (Events / History)

These tables store time-series records linked to individual livestock. Each record has a `livestock_uuid` FK and a date/timestamp.

### public_weight_record

Weight measurements over time. Critical for tracking gain, loss, and marketability.

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Record identifier (PK) |
| livestock_uuid | STRING | FK to `public_livestock.uuid` |
| ranch_uuid | STRING | FK to ranch (for partition/filter efficiency) |
| weight | FLOAT64 | Weight value |
| weight_unit | STRING | Unit (e.g., `LBS`, `KG`) |
| recorded_at | TIMESTAMP/DATE | When the measurement was taken |
| notes | STRING | Optional notes |
| is_deleted | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | Record creation |

**Common queries:**
- Latest weight: `ORDER BY recorded_at DESC LIMIT 1`
- Weight gain: Compare earliest vs latest, or sequential differences
- Average weight for group: aggregate by group_uuid via livestock join

### public_bcs_record

Body Condition Score records. Scale typically 1–9 for beef cattle.

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Record identifier (PK) |
| livestock_uuid | STRING | FK to `public_livestock.uuid` |
| ranch_uuid | STRING | FK to ranch |
| score | FLOAT64/INT64 | BCS value (e.g., 1–9 scale) |
| recorded_at | TIMESTAMP/DATE | When scored |
| notes | STRING | Optional notes |
| is_deleted | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | Record creation |

### public_vaccination_record

Vaccination and treatment history.

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Record identifier (PK) |
| livestock_uuid | STRING | FK to `public_livestock.uuid` |
| ranch_uuid | STRING | FK to ranch |
| vaccine_name | STRING | Name/type of vaccine or treatment |
| administered_at | TIMESTAMP/DATE | When administered |
| dose | STRING | Dosage info |
| administered_by | STRING | Who administered |
| notes | STRING | Optional notes |
| is_deleted | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | Record creation |

### public_note_record

General notes and observations attached to livestock.

| Column | Type | Description |
|--------|------|-------------|
| uuid | STRING | Record identifier (PK) |
| livestock_uuid | STRING | FK to `public_livestock.uuid` |
| ranch_uuid | STRING | FK to ranch |
| content | STRING | Note text |
| note_type | STRING | Category/type of note |
| recorded_at | TIMESTAMP/DATE | When the note was recorded |
| author | STRING | Who wrote the note |
| is_deleted | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | Record creation |

---

## Denormalized Views

### livestock_denorm

Pre-joined view that includes ranch names alongside livestock data. **Prefer this for queries that need ranch names** — avoids manual joins.

| Column | Type | Description |
|--------|------|-------------|
| ranch_name | STRING | Ranch display name |
| ranch_uuid | STRING | Ranch UUID |
| uuid | STRING | Livestock UUID |
| ear_tag_id | STRING | Tag number |
| name | STRING | Animal name |
| livestock_status | STRING | Status |
| sex | STRING | Sex |
| breed | STRING | Breed |

> This view may contain additional denormalized fields. Check `INFORMATION_SCHEMA` for the full list.

---

## Relationships

```
public_ranch (uuid = ranch_uuid everywhere)
  ├── public_livestock (ranch_uuid)
  │     ├── public_weight_record (livestock_uuid)
  │     ├── public_bcs_record (livestock_uuid)
  │     ├── public_vaccination_record (livestock_uuid)
  │     └── public_note_record (livestock_uuid)
  ├── public_group (ranch_uuid)
  │     └── public_livestock.group_uuid → public_group.uuid
  └── public_land (ranch_uuid)
        └── public_livestock.land_uuid → public_land.uuid
```

**Key principle:** `ranch_uuid` is the universal partition key. Always include it in WHERE clauses when querying within a ranch scope — it dramatically reduces data scanned.

---

## Important Notes

1. **Soft deletes (`is_deleted`) — ALWAYS FILTER** — Almost every table has an `is_deleted` BOOLEAN column. You **must** include `WHERE is_deleted = false` on every query by default. Rows with `is_deleted = true` are soft-deleted (removed in the app but kept for audit). Including them produces inflated counts, ghost records, and wrong data. Only omit this filter when the user explicitly asks about deleted/archived records. Apply this filter on **both sides** of JOINs when both tables have the column.
2. **`public_ranch` is the ranch source of truth** — Use it for ranch name resolution, location, metadata, and owner lookups. It does NOT have `is_deleted`. For queries that need ranch name alongside livestock data, you can either JOIN `public_ranch` or use the `livestock_denorm` view
3. **Status filtering** — `livestock_status` on `public_livestock` controls lifecycle state. Default to `ACTIVE` unless user asks otherwise. This is **in addition to** `is_deleted = false`, not a replacement for it
4. **UUIDs everywhere** — All PKs and FKs are UUID strings. Never assume integer IDs
5. **Timestamps** — `created_at` = when the DB record was created; `recorded_at` = when the event actually happened in the real world. Use `recorded_at` for chronological queries
6. **Table naming** — Tables follow `public_<entity>` pattern. Record/event tables follow `public_<entity>_record` pattern. Views don't have the `public_` prefix (e.g., `livestock_denorm`)
