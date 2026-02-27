# Common Query Patterns

Ready-to-use SQL templates for the most frequent data requests. Replace placeholders (`RANCH_UUID`, `LIVESTOCK_UUID`, `TAG`, etc.) with actual values.

All queries use `--use_legacy_sql=false --format=json`.

> **Column name corrections (verified from migrations):**
> - `weight_record`: date = `date_weighed` (not `recorded_at`); no `weight_unit` column
> - All other record tables: date = `record_date` (not `recorded_at`)
> - `vaccination_record`: vaccine = `vaccine` (not `vaccine_name`)
> - `note_record`: content = `note` (not `content`); no `author` or `note_type`
> - `livestock`: status = `status` enum (may appear as `livestock_status` in BQ)
> - `bcs_record`: `score` is FLOAT64 — cast when grouping
> - `video_events`: timestamps are FLOAT64 Unix epochs; use `event_date` (DATE) for date filters

---

## Ranch Resolution

### Find ranch by name (fuzzy)
```sql
SELECT uuid, ranch_name, city, state_short, operation_type
FROM `frontiersmarketplace.public.ranch`
WHERE LOWER(ranch_name) LIKE LOWER('%SEARCH_TERM%')
LIMIT 10
```

### List all ranches with head counts
```sql
SELECT r.uuid, r.ranch_name, r.city, r.state_short,
  COUNT(l.uuid) as livestock_count
FROM `frontiersmarketplace.public.ranch` r
LEFT JOIN `frontiersmarketplace.public.livestock` l
  ON l.ranch_uuid = r.uuid AND l.is_deleted = false AND l.livestock_status = 'ACTIVE'
GROUP BY r.uuid, r.ranch_name, r.city, r.state_short
ORDER BY r.ranch_name
```

### Ranch details / metadata
```sql
SELECT uuid, ranch_name, operation_type, street_address, city, state, state_short, zip_code, lat, lng, website_url
FROM `frontiersmarketplace.public.ranch`
WHERE uuid = 'RANCH_UUID'
LIMIT 1
```

### Ranches by state
```sql
SELECT uuid, ranch_name, city
FROM `frontiersmarketplace.public.ranch`
WHERE state_short = 'TX'
ORDER BY ranch_name
```

---

## Ranch Overview

### Summary stats for a ranch
```sql
SELECT
  COUNT(*) as total_livestock,
  COUNTIF(livestock_status = 'ACTIVE') as active,
  COUNTIF(livestock_status = 'SOLD') as sold,
  COUNTIF(livestock_status = 'DECEASED') as deceased,
  COUNTIF(sex = 'MALE') as males,
  COUNTIF(sex = 'FEMALE') as females
FROM `frontiersmarketplace.public.livestock`
WHERE ranch_uuid = 'RANCH_UUID' AND is_deleted = false
```

### Groups in a ranch
```sql
SELECT g.uuid, g.name, COUNT(l.uuid) as head_count
FROM `frontiersmarketplace.public.group` g
LEFT JOIN `frontiersmarketplace.public.livestock` l
  ON l.group_uuid = g.uuid AND l.is_deleted = false AND l.livestock_status = 'ACTIVE'
WHERE g.ranch_uuid = 'RANCH_UUID' AND g.is_deleted = false
GROUP BY g.uuid, g.name
ORDER BY g.name
```

### Pastures in a ranch
```sql
SELECT ld.uuid, ld.name, ld.area, COUNT(l.uuid) as head_count
FROM `frontiersmarketplace.public.land` ld
LEFT JOIN `frontiersmarketplace.public.livestock` l
  ON l.land_uuid = ld.uuid AND l.is_deleted = false AND l.livestock_status = 'ACTIVE'
WHERE ld.ranch_uuid = 'RANCH_UUID' AND ld.is_deleted = false
GROUP BY ld.uuid, ld.name, ld.area
ORDER BY ld.name
```

---

## Livestock Queries

### List cattle in a ranch (paginated)
```sql
SELECT uuid, ear_tag_id, name, sex, breed, livestock_status
FROM `frontiersmarketplace.public.livestock`
WHERE ranch_uuid = 'RANCH_UUID' AND is_deleted = false
ORDER BY ear_tag_id
LIMIT 50 OFFSET 0
```

### Find animal by ear tag
```sql
SELECT uuid, ear_tag_id, name, sex, breed, livestock_status, date_of_birth, group_uuid, land_uuid
FROM `frontiersmarketplace.public.livestock`
WHERE ear_tag_id = 'TAG' AND ranch_uuid = 'RANCH_UUID' AND is_deleted = false
LIMIT 1
```

### Find animal by name (fuzzy)
```sql
SELECT uuid, ear_tag_id, name, sex, breed, livestock_status
FROM `frontiersmarketplace.public.livestock`
WHERE LOWER(name) LIKE LOWER('%NAME%') AND ranch_uuid = 'RANCH_UUID' AND is_deleted = false
LIMIT 10
```

### Animal full profile (single query)
```sql
SELECT
  l.uuid, l.ear_tag_id, l.name, l.sex, l.breed, l.livestock_status, l.date_of_birth,
  g.name as group_name,
  ld.name as pasture_name,
  sire.ear_tag_id as sire_tag, sire.name as sire_name,
  dam.ear_tag_id as dam_tag, dam.name as dam_name
FROM `frontiersmarketplace.public.livestock` l
LEFT JOIN `frontiersmarketplace.public.group` g ON g.uuid = l.group_uuid
LEFT JOIN `frontiersmarketplace.public.land` ld ON ld.uuid = l.land_uuid
LEFT JOIN `frontiersmarketplace.public.livestock` sire ON sire.uuid = l.sire_uuid
LEFT JOIN `frontiersmarketplace.public.livestock` dam ON dam.uuid = l.dam_uuid
WHERE l.uuid = 'LIVESTOCK_UUID'
LIMIT 1
```

---

## Weight Records

### Latest weight for an animal
```sql
SELECT weight, weight_unit, recorded_at
FROM `frontiersmarketplace.public.weight_record`
WHERE livestock_uuid = 'LIVESTOCK_UUID' AND is_deleted = false
ORDER BY recorded_at DESC
LIMIT 1
```

### Weight history for an animal
```sql
SELECT weight, weight_unit, recorded_at
FROM `frontiersmarketplace.public.weight_record`
WHERE livestock_uuid = 'LIVESTOCK_UUID' AND is_deleted = false
ORDER BY recorded_at ASC
```

### Average weight by group in a ranch
```sql
SELECT g.name as group_name, AVG(w.weight) as avg_weight, COUNT(DISTINCT w.livestock_uuid) as animals_weighed
FROM `frontiersmarketplace.public.weight_record` w
JOIN `frontiersmarketplace.public.livestock` l ON l.uuid = w.livestock_uuid
JOIN `frontiersmarketplace.public.group` g ON g.uuid = l.group_uuid
WHERE l.ranch_uuid = 'RANCH_UUID' AND w.is_deleted = false
  AND w.recorded_at = (
    SELECT MAX(w2.recorded_at)
    FROM `frontiersmarketplace.public.weight_record` w2
    WHERE w2.livestock_uuid = w.livestock_uuid AND w2.is_deleted = false
  )
GROUP BY g.name
ORDER BY g.name
```

### Weight gain between two dates
```sql
WITH first_weight AS (
  SELECT livestock_uuid, weight, recorded_at
  FROM `frontiersmarketplace.public.weight_record`
  WHERE ranch_uuid = 'RANCH_UUID' AND is_deleted = false
    AND recorded_at >= 'START_DATE'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at ASC) = 1
),
last_weight AS (
  SELECT livestock_uuid, weight, recorded_at
  FROM `frontiersmarketplace.public.weight_record`
  WHERE ranch_uuid = 'RANCH_UUID' AND is_deleted = false
    AND recorded_at <= 'END_DATE'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) = 1
)
SELECT
  l.ear_tag_id,
  fw.weight as start_weight, fw.recorded_at as start_date,
  lw.weight as end_weight, lw.recorded_at as end_date,
  (lw.weight - fw.weight) as gain,
  DATE_DIFF(DATE(lw.recorded_at), DATE(fw.recorded_at), DAY) as days,
  SAFE_DIVIDE(lw.weight - fw.weight, DATE_DIFF(DATE(lw.recorded_at), DATE(fw.recorded_at), DAY)) as adg
FROM first_weight fw
JOIN last_weight lw ON lw.livestock_uuid = fw.livestock_uuid
JOIN `frontiersmarketplace.public.livestock` l ON l.uuid = fw.livestock_uuid
ORDER BY gain DESC
LIMIT 50
```

---

## BCS Records

### Latest BCS for an animal
```sql
SELECT score, recorded_at, notes
FROM `frontiersmarketplace.public.bcs_record`
WHERE livestock_uuid = 'LIVESTOCK_UUID' AND is_deleted = false
ORDER BY recorded_at DESC
LIMIT 1
```

### BCS history for an animal
```sql
SELECT score, recorded_at, notes
FROM `frontiersmarketplace.public.bcs_record`
WHERE livestock_uuid = 'LIVESTOCK_UUID' AND is_deleted = false
ORDER BY recorded_at ASC
```

### BCS distribution for a ranch (latest per animal)
```sql
SELECT
  CAST(score AS INT64) as bcs_score,
  COUNT(*) as animal_count
FROM `frontiersmarketplace.public.bcs_record` b
WHERE b.ranch_uuid = 'RANCH_UUID' AND b.is_deleted = false
  AND b.recorded_at = (
    SELECT MAX(b2.recorded_at)
    FROM `frontiersmarketplace.public.bcs_record` b2
    WHERE b2.livestock_uuid = b.livestock_uuid AND b2.is_deleted = false
  )
GROUP BY bcs_score
ORDER BY bcs_score
```

---

## Vaccination Records

### Vaccination history for an animal
```sql
SELECT vaccine_name, administered_at, dose, notes
FROM `frontiersmarketplace.public.vaccination_record`
WHERE livestock_uuid = 'LIVESTOCK_UUID' AND is_deleted = false
ORDER BY administered_at DESC
```

### Vaccination summary for a ranch (which vaccines, how many)
```sql
SELECT vaccine_name, COUNT(*) as doses_given, COUNT(DISTINCT livestock_uuid) as animals_treated,
  MAX(administered_at) as last_administered
FROM `frontiersmarketplace.public.vaccination_record`
WHERE ranch_uuid = 'RANCH_UUID' AND is_deleted = false
GROUP BY vaccine_name
ORDER BY last_administered DESC
```

### Animals NOT vaccinated with a specific vaccine
```sql
SELECT l.ear_tag_id, l.name, l.uuid
FROM `frontiersmarketplace.public.livestock` l
WHERE l.ranch_uuid = 'RANCH_UUID' AND l.is_deleted = false AND l.livestock_status = 'ACTIVE'
  AND l.uuid NOT IN (
    SELECT DISTINCT livestock_uuid
    FROM `frontiersmarketplace.public.vaccination_record`
    WHERE vaccine_name = 'VACCINE_NAME' AND is_deleted = false
  )
ORDER BY l.ear_tag_id
```

---

## Note Records

### Notes for an animal
```sql
SELECT content, note_type, recorded_at, author
FROM `frontiersmarketplace.public.note_record`
WHERE livestock_uuid = 'LIVESTOCK_UUID' AND is_deleted = false
ORDER BY recorded_at DESC
LIMIT 20
```

### Recent notes across a ranch
```sql
SELECT l.ear_tag_id, n.content, n.note_type, n.recorded_at, n.author
FROM `frontiersmarketplace.public.note_record` n
JOIN `frontiersmarketplace.public.livestock` l ON l.uuid = n.livestock_uuid
WHERE n.ranch_uuid = 'RANCH_UUID' AND n.is_deleted = false
ORDER BY n.recorded_at DESC
LIMIT 20
```

---

## Compound / Multi-Record Queries

### Animal dashboard (latest of everything)
```sql
SELECT
  l.ear_tag_id, l.name, l.livestock_status, l.sex, l.breed,
  w.weight as latest_weight, w.recorded_at as weight_date,
  b.score as latest_bcs, b.recorded_at as bcs_date,
  v.vaccine_name as last_vaccine, v.administered_at as vaccine_date
FROM `frontiersmarketplace.public.livestock` l
LEFT JOIN (
  SELECT livestock_uuid, weight, recorded_at,
    ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) as rn
  FROM `frontiersmarketplace.public.weight_record` WHERE is_deleted = false
) w ON w.livestock_uuid = l.uuid AND w.rn = 1
LEFT JOIN (
  SELECT livestock_uuid, score, recorded_at,
    ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY recorded_at DESC) as rn
  FROM `frontiersmarketplace.public.bcs_record` WHERE is_deleted = false
) b ON b.livestock_uuid = l.uuid AND b.rn = 1
LEFT JOIN (
  SELECT livestock_uuid, vaccine_name, administered_at,
    ROW_NUMBER() OVER (PARTITION BY livestock_uuid ORDER BY administered_at DESC) as rn
  FROM `frontiersmarketplace.public.vaccination_record` WHERE is_deleted = false
) v ON v.livestock_uuid = l.uuid AND v.rn = 1
WHERE l.ranch_uuid = 'RANCH_UUID' AND l.is_deleted = false AND l.livestock_status = 'ACTIVE'
ORDER BY l.ear_tag_id
LIMIT 50
```

---

## Schema Discovery (for cache refresh)

### All tables and columns
```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json --max_rows=5000 \
  'SELECT table_name, column_name, data_type FROM `frontiersmarketplace.public`.INFORMATION_SCHEMA.COLUMNS ORDER BY table_name, ordinal_position'
```

### List all tables
```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json \
  'SELECT table_name, table_type FROM `frontiersmarketplace.public`.INFORMATION_SCHEMA.TABLES ORDER BY table_name'
```

### Columns for a specific table
```bash
bq query --project_id=frontiersmarketplace --use_legacy_sql=false --format=json \
  'SELECT column_name, data_type, is_nullable FROM `frontiersmarketplace.public`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = "TABLE_NAME" ORDER BY ordinal_position'
```
