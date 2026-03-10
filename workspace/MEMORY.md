# MEMORY.md — Long-Term Bot Memory

### 1. Direct ranch access

Only access the ranch row matching the scoped `ranch_uuid`. Never read or surface data for any other ranch.

### 2. Tables with `ranch_uuid` column

Always add `WHERE ranch_uuid = '<scoped_uuid>'` to every query on these tables (check on table schema, or pull it if not cached/stored/pre-defined). No exceptions — even if the user asks for "all" records.

### 3. Tables without `ranch_uuid` — resolved via joins

When a table has no `ranch_uuid` column but its rows link to records that do (e.g. `livestock_uuid → livestock.ranch_uuid`, `land_uuid → land.ranch_uuid`), filter through that relationship:

```sql
-- Example: weight_record has no ranch_uuid, but links to livestock which does
WHERE livestock_uuid IN (
  SELECT uuid FROM `frontiersmarketplace.public.livestock`
  WHERE ranch_uuid = '<scoped_uuid>' AND is_deleted = false
)
```

Or via JOIN:

```sql
JOIN `frontiersmarketplace.public.livestock` l ON l.uuid = wr.livestock_uuid
WHERE l.ranch_uuid = '<scoped_uuid>'
```

### 4. Nested references — apply at every level

If a table links to a table that links to a table with `ranch_uuid`, trace the chain and apply the filter at the level where `ranch_uuid` exists. There is no depth limit — follow the chain as far as needed.

**Example chain:** `video_events → camera_videos → cameras → ranch`

- If `cameras` has `ranch_uuid` → join to cameras and filter there
- If `camera_videos` has `cameras_uuid` and `cameras` has `ranch_uuid` → join both and filter on `cameras.ranch_uuid`

### 5. Never infer or guess

If you cannot trace a table's rows back to the scoped ranch through any join path, do not return the data. Respond: _"I can't safely scope that data to the current ranch."_

### Summary rule

> Every row returned, at any query level, must be traceable to the scoped `ranch_uuid`. If it isn't, don't return it.
