# BQ Schema Cache

## Last updated: 2026-02-26 (rebuilt from knex migrations + BQ INFORMATION_SCHEMA)

### BQ Type Mapping Notes

PostgreSQL → BigQuery type conversions used in this dataset:

- `text` / `varchar` → `STRING`
- `float8` / `double precision` → `FLOAT64`
- `boolean` → `BOOL`
- `timestamptz` / `timestamp` → `TIMESTAMP`
- `integer` → `INT64`
- `bigint` → `INT64`
- `jsonb` / `text[]` / arrays → `JSON`
- enums → `STRING` (the enum values still apply, just not enforced by BQ)
- All replicated tables have a `datastream_metadata` STRUCT column added by the replication layer

---

## Core Entity Tables

### ranch

uuid (STRING), organization_uuid (STRING), owner_uuid (STRING), ranch_name (STRING), operation_type (JSON), address (STRING), city (STRING), state (STRING), state_short (STRING), zip_code (STRING), street_address (STRING), street_number (STRING), lat (FLOAT64), lng (FLOAT64), website_url (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: NO** — no is_deleted column on ranch

### livestock

uuid (STRING), ranch_uuid (STRING), name (STRING), ear_tag_id (STRING), ear_tag_color (STRING), dam_uuid (STRING), sire_uuid (STRING), dam_reg_number (STRING), sire_reg_number (STRING), is_calf (BOOL), animal_type (STRING), is_approved (BOOL), is_deleted (BOOL), registration_number (STRING), type (STRING), breed (STRING), breed_description (STRING), birthday (TIMESTAMP), horned (BOOL), group_uuid (STRING), status (STRING), average_daily_gain (FLOAT64), current_weight (FLOAT64), electronic_id (STRING), calving_record_id (STRING), description (STRING), created_from (STRING), last_updated_from (STRING), weight_method (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**status enum values: ACTIVE, INACTIVE, SOLD, DEAD, REFERENCE**
**NOTE: The status column is named `status` (not `livestock_status`). Confirm actual BQ column name via INFORMATION_SCHEMA if queries fail.**
**dam_uuid / sire_uuid: nullable self-references, no FK enforced — always LEFT JOIN**

### group

uuid (STRING), ranch_uuid (STRING), name (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**RESERVED WORD: always use backticks → `frontiersmarketplace.public.group`**

### land

uuid (STRING), ranch_uuid (STRING), name (STRING), type (STRING), area (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**area is STRING (not numeric) — do not cast or do math on it**

---

## Record Tables (Livestock Event History)

All record tables have `is_deleted (BOOL)` and `livestock_uuid (STRING)`.
**Primary date column for ordering chronologically: `record_date` (not `recorded_at`).**
**ranch_uuid may or may not be present — if a `WHERE ranch_uuid = ...` query fails, filter via JOIN to livestock instead.**

### weight_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), weight (FLOAT64), corrected_weight (FLOAT64), date_weighed (TIMESTAMP), weight_method (STRING), type (STRING), weight_record_device_uuid (STRING), prediction_uuid (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `date_weighed` (not `recorded_at` — that column does not exist)**
**NO `weight_unit` column — unit is implicitly lbs**
**type enum: WEANING, YEARLING, OTHER**
**weight_method enum: calibrated_scale, visual_estimate, AI, other**

### bcs_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), score (FLOAT64), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**
**score is FLOAT64 — cast to INT64 when grouping: CAST(score AS INT64)**

### vaccination_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), vaccine (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**
**Vaccine name column is `vaccine` (not `vaccine_name`)**
**NO `dose`, `administered_at`, or `administered_by` columns — those are in the `vaccinations` table (different table)**

### note_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), note (STRING), record_date (TIMESTAMP), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**
**Content column is `note` (not `content`)**
**NO `note_type`, `author` columns — the note_record card is simple**

### calving_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), calf_ear_tag (STRING), description (STRING), birth_weight (FLOAT64), dystocia (STRING), vigor (STRING), weight_method (STRING), gender (STRING), record_date (TIMESTAMP), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**
**dystocia enum: no_assistance, assisted_easy, assisted_difficult, caesarean, breech_birth**
**vigor enum: nursed_immediately, nursed_on_own, required_assistance, died_shortly_after_birth, dead_on_arrival**
**gender enum: Bull Calf, Heifer Calf**
**livestock_uuid is the DAM (mother), not the calf**

### death_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), death_cause (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**
**death_cause enum: digestive, respiratory, calving, deficiency, weather, other, unknown, zoonotic**

### pregnancy_check_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), check_method (STRING), pregnancy_status (STRING), time_pregnant (FLOAT64), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**
**check_method enum: palpation, ultrasound, observation, blood, urine**
**pregnancy_status enum: pregnant, open, re-check**
**time_pregnant: months pregnant (FLOAT64)**

### transfer_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), buyer (STRING), seller (STRING), price (FLOAT64), buyer_uuid (STRING), seller_uuid (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**

### harvest_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), live_weight (INT64), carcass_weight (INT64), price (FLOAT64), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**

### breeding_serv_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), breed_serv_type (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**
**breed_serv_type enum: Natural, Artificial, Embryo**

### transaction_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), transaction_type (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**transaction_type enum: BUY, SELL**

### doctoring_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**

### foot_score_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), angle_scale (STRING), claw_set_scale (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**

### implant_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), product (STRING), question (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**

### udder_teat_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), suspension_scale (STRING), size_scale (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**

### ear_tag_record

uuid (STRING), card_type (STRING), livestock_uuid (STRING), ear_tag_id (STRING), ear_tag_color (STRING), ear_tag_installed_date (STRING), status (STRING), record_date (TIMESTAMP), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**status enum: ACTIVE, LOST**

### worming_record, culling_record, horning_record, heat_detect_record, transport_record, consign_record, exam_record, perm_record

Pattern: uuid (STRING), card_type (STRING), livestock_uuid (STRING), record_date (TIMESTAMP), note (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**All follow the same structure. PRIMARY DATE: `record_date`.**

---

## Advanced Livestock Tables

### vaccinations

(Separate from vaccination_record — this is a more detailed vaccination table)
uuid (STRING), livestock_uuid (STRING), vaccination_date (TIMESTAMP), vaccine_name (STRING), manufacturer (STRING), lot_number (STRING), expiration_date (TIMESTAMP), dosage (FLOAT64), dosage_unit (STRING), application_method (STRING), administered_by (STRING), booster_date (TIMESTAMP), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `vaccination_date`**
**This table HAS `vaccine_name`, `dosage`, `administered_by` — unlike `vaccination_record`**

### treatments

uuid (STRING), livestock_uuid (STRING), treatment_date (TIMESTAMP), treatment_type (STRING), product (STRING), dosage (FLOAT64), dosage_unit (STRING), application_method (STRING), location (STRING), administered_by (STRING), withdrawal_date (TIMESTAMP), lot_number (STRING), comments (STRING), booster_date (TIMESTAMP), category (STRING), medication (STRING), diagnosis (STRING), temperature (FLOAT64), route (STRING), serial_number (STRING), manufacturer (STRING), primary_treatment_uuid (STRING), booster_administered (BOOL), expiration_date (TIMESTAMP), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `treatment_date`**

### epds

uuid (STRING), livestock_uuid (STRING), record_date (TIMESTAMP), is_deleted (BOOL), status (STRING), reporting_period (STRING), calving_ease_val (FLOAT64), calving_ease_acc (FLOAT64), birth_weight_val (FLOAT64), birth_weight_acc (FLOAT64), weaning_weight_val (FLOAT64), yearling_weight_val (FLOAT64), milk_val (FLOAT64), carcass_weight_index_val (FLOAT64), ribeye_area_val (FLOAT64), marbling_val (FLOAT64), fat_val (FLOAT64), ced_epd (FLOAT64), bw_epd (FLOAT64), ww_epd (FLOAT64), yw_epd (FLOAT64), milk_epd (FLOAT64), [many more EPD/ACC/rank columns — see full list in 2025011201006 migration], created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**
**PRIMARY DATE: `record_date`**

### calving_record (already above)

### gain_tests

uuid (STRING), livestock_uuid (STRING), contemporary_group (STRING), gain (FLOAT64), adg (FLOAT64), adg_ratio (FLOAT64), adg_rank (INT64), rfi (FLOAT64), rfi_rank (INT64), dmi (FLOAT64), dmi_ratio (FLOAT64), fg (FLOAT64), fg_ratio (FLOAT64), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**

### measurements

uuid (STRING), livestock_uuid (STRING), measurement_date (TIMESTAMP), weight (FLOAT64), height (FLOAT64), bcs (FLOAT64), hip_height (FLOAT64), frame_score (FLOAT64), scrotal (FLOAT64), pelvic_area (FLOAT64), notes (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `measurement_date`**

### carcass_data

uuid (STRING), livestock_uuid (STRING), slaughter_date (TIMESTAMP), hot_carcass_weight (FLOAT64), dressing_percentage (FLOAT64), ribeye_area (FLOAT64), marbling_score (FLOAT64), fat_thickness (FLOAT64), kidney_fat (FLOAT64), yield_grade (FLOAT64), quality_grade (STRING), maturity (STRING), color (STRING), texture (STRING), firmness (STRING), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `slaughter_date`**

### breedings

uuid (STRING), livestock_uuid (STRING), sire_livestock_uuid (STRING), breeding_method (STRING), breeding_date (TIMESTAMP), breeding_type (STRING), breeding_end_date (TIMESTAMP), days_exposed (INT64), estimated_calving_date (TIMESTAMP), comments (STRING), technician (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `breeding_date`**
**livestock_uuid = the dam; sire_livestock_uuid = the sire**

### breed_compositions

uuid (STRING), livestock_uuid (STRING), breed_uuid (STRING), percentage (FLOAT64)
**has is_deleted: NO**
**No timestamps**

### ownerships

uuid (STRING), livestock_uuid (STRING), contact_uuid (STRING), purchase_date (TIMESTAMP), purchase_price (FLOAT64), sale_date (TIMESTAMP), sale_price (FLOAT64), genetic_pct (FLOAT64), possession_pct (FLOAT64), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**

### gallery_item

uuid (STRING), livestock_uuid (STRING), path (STRING), type (STRING), url (STRING), displayable (BOOL), priority (FLOAT64), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**

---

## Ranch Organization Tables

### land (see Core Entity Tables above)

### movement

uuid (STRING), land_from_uuid (STRING), land_to_uuid (STRING), date_of_movement (TIMESTAMP), movement_type (STRING), group_uuid (STRING), note (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `date_of_movement`**

### contacts

uuid (STRING), ranch_uuid (STRING), name (STRING), company (STRING), email (STRING), phone (STRING), address (STRING), city (STRING), state (STRING), zip (STRING), contact_type (STRING), first_name (STRING), last_name (STRING), status (STRING), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**

### rainfall

uuid (STRING), ranch_uuid (STRING), rainfall_date (TIMESTAMP), rainfall_amt (FLOAT64), comments (STRING), location (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `rainfall_date`**

### events

uuid (STRING), ranch_uuid (STRING), summary (STRING), start_at (TIMESTAMP), end_at (TIMESTAMP), all_day (BOOL), color (STRING), location (STRING), category (STRING), description (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**PRIMARY DATE: `start_at`**

### equipment

uuid (STRING), ranch_uuid (STRING), name (STRING), description (STRING), manufacturer (STRING), model (STRING), serial_number (STRING), purchase_date (TIMESTAMP), purchase_price (FLOAT64), status (STRING), location (STRING), notes (STRING), category (STRING), make (STRING), year (STRING), vin (STRING), color (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**

### tanks

uuid (STRING), ranch_uuid (STRING), name (STRING), location (STRING), description (STRING), capacity (FLOAT64), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**

### semen

uuid (STRING), ranch_uuid (STRING), livestock_uuid (STRING), tank_uuid (STRING), canister (STRING), units (INT64), collection_date (TIMESTAMP), batch_code (STRING), registration_number (STRING), purchased (BOOL), purchase_price (FLOAT64), asking_price (FLOAT64), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**livestock_uuid = the sire animal**

### categories

uuid (STRING), ranch_uuid (STRING), name (STRING), description (STRING), category_type (STRING), color (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**

### expenses

uuid (STRING), ranch_uuid (STRING), livestock_uuid (STRING), expense_date (TIMESTAMP), category (STRING), amount (FLOAT64), description (STRING), payment_method (STRING), item (STRING), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**livestock_uuid is optional (nullable)**

### income

uuid (STRING), ranch_uuid (STRING), livestock_uuid (STRING), income_date (TIMESTAMP), category (STRING), amount (FLOAT64), description (STRING), payment_method (STRING), item (STRING), comments (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**
**livestock_uuid is optional (nullable)**

### ranch_settings

uuid (STRING), ranch_uuid (STRING), hidden_epds (JSON), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: NO**

### association

uuid (STRING), name (STRING), abbreviation (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**

### ranch_association

uuid (STRING), ranch_uuid (STRING), association_uuid (STRING), registration_number (STRING), allow_import (BOOL), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**

### salesbook

uuid (STRING), ranch_uuid (STRING), name (STRING), date_of_sale (TIMESTAMP), csv_link (STRING), pdf_link (STRING), status (STRING), address (STRING), end_date_time (TIMESTAMP), timezone (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**
**status enum: review, published, expired**

---

## Camera & Video Tables

### cameras

uuid (STRING), name (STRING), display_name (STRING), description (STRING), location_path (STRING), ranch_uuid (STRING), external_id (STRING), thumbnail_url (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**

### camera_videos

uuid (STRING), camera_uuid (STRING), thumbnail_url (STRING), video_url (STRING), video_path (STRING), video_name (STRING), size (INT64), duration (FLOAT64), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**size = file size in bytes; duration = seconds (FLOAT64)**

### video_events

uuid (STRING), video_uuid (STRING), event_type (STRING), description (STRING), start_timestamp (FLOAT64), end_timestamp (FLOAT64), confidence (FLOAT64), tags (JSON), ranch_id (STRING), camera_id (STRING), model_name (STRING), pipeline_version (STRING), env (STRING), event_date (DATE), video_uri (STRING), video_start_ts (TIMESTAMP), event_offset_start_s (FLOAT64), event_offset_end_s (FLOAT64), severity (STRING), risk_score (FLOAT64), candidate_key (STRING), is_duplicate (BOOL), marker (JSON), visibility (JSON), death_markers (JSON), death_markers_confidence (FLOAT64), recumbency_observed (BOOL), recumbency_confidence (FLOAT64), quality_flags (JSON), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT)
**has is_deleted: YES**
**start_timestamp / end_timestamp: Unix epoch seconds (FLOAT64) — convert with TIMESTAMP_SECONDS(CAST(start_timestamp AS INT64))**
**event_date: DATE (not TIMESTAMP) — use directly for date filtering**
**ranch_id: STRING identifier (not a UUID FK, just a string tag)**
**event_type enum values (partial list): ACUTE_DISTRESS, HEALTH_DOWN_ANIMAL, HEALTH_LAMENESS_DETECTED, CALVING_NEONATAL_EVENT, INVENTORY_COUNT, OPS_GATE_LEFT_OPEN, POSSIBLE_DEATH, PERSON_ACTIVITY, ANIMAL_DISTRESS_EVENT, ANIMAL_HEALTH_INDICATOR, etc.**

### land_cameras

uuid (STRING), land_uuid (STRING), camera_uuid (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**
**Junction: use to find which cameras are on which pastures**

### camera_reports

uuid (STRING), camera_uuid (STRING), report_url (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**

### prediction_results

uuid (STRING), ranch_uuid (STRING), livestock_uuid (STRING), ear_tag_id (STRING), predicted_weight (FLOAT64), result_class (STRING), image_url (STRING), ear_tag_image_url (STRING), date_scanned (TIMESTAMP), event_timestamp_start (INT64), event_timestamp_end (INT64), video_name (STRING)
**has is_deleted: NO**
**result_class enum: update, new, failed**
**livestock_uuid is nullable (prediction may not be matched to an animal yet)**

### unverified_weight_records

uuid (STRING), livestock_uuid (STRING), ranch_uuid (STRING), weight (FLOAT64), date_weighed (TIMESTAMP), gcs_video_path (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**has is_deleted: YES**
**AI-predicted weights awaiting human confirmation**

---

## User & Platform Tables (rarely needed for ranch queries)

### user

uuid (STRING), email (STRING), name (STRING), phone (STRING), verified_level (INT64), source (STRING), provider (STRING), phone_verified (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP)

### organization

uuid (STRING), name (STRING), address (STRING), city (STRING), state (STRING), state_short (STRING), lat (FLOAT64), lng (FLOAT64), website_url (STRING), email (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)

### user_ranch_permissions

uuid (STRING), user_uuid (STRING), ranch_uuid (STRING), role (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**role enum: OWNER, ADMIN, USER, GUEST**

---

## Critical Gotchas (DO NOT GET WRONG)

1. **weight_record date = `date_weighed`** — not `recorded_at`, not `record_date`
2. **All other record table dates = `record_date`** — not `recorded_at`, not `administered_at`
3. **vaccination_record vaccine column = `vaccine`** — not `vaccine_name`; no dose/administered_by here
4. **note_record content column = `note`** — not `content`; no author/note_type here
5. **livestock status column = `status`** — may appear as `livestock_status` in BQ — verify if query fails
6. **bcs_record score is FLOAT64** — cast when grouping: `CAST(score AS INT64)`
7. **video_events timestamps are FLOAT64 Unix epochs** — convert: `TIMESTAMP_SECONDS(CAST(start_timestamp AS INT64))`
8. **video_events has `event_date DATE`** — use this for date filtering, not start_timestamp
9. **land.area is STRING** — cannot do numeric comparisons on it
10. **`group` is a reserved word** — always backtick: `` `frontiersmarketplace.public.group` ``
11. **vaccinations vs vaccination_record** — two different tables; `vaccinations` has more detail (vaccine_name, dose, administered_by); `vaccination_record` is a simple event card
12. **camera_reports are pen reports** — use `camera_reports` to get reports when user asks about camera reports or pen reports. Always return the info that the `report_url` column contains, not the URL itself.
