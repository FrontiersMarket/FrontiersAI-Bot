# BQ Schema Cache
## Last updated: 2026-02-25

### ranch
uuid (STRING), organization_uuid (STRING), owner_uuid (STRING), ranch_name (STRING), operation_type (JSON), address (STRING), city (STRING), state (STRING), state_short (STRING), zip_code (STRING), street_address (STRING), street_number (STRING), lat (FLOAT64), lng (FLOAT64), website_url (STRING), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT<uuid STRING, source_timestamp INT64>)
**has is_deleted: assume yes (check if query fails)**

### cameras
uuid (STRING), name (STRING(255)), display_name (STRING(255)), description (STRING), location_path (STRING), ranch_uuid (STRING), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), datastream_metadata (STRUCT<uuid STRING, source_timestamp INT64>), thumbnail_url (STRING(255)), external_id (STRING(255))
**has is_deleted: yes**

### video_events
uuid (STRING), video_uuid (STRING), event_type (STRING), description (STRING), start_timestamp (FLOAT64), end_timestamp (FLOAT64), is_deleted (BOOL), created_at (TIMESTAMP), updated_at (TIMESTAMP), confidence (FLOAT64), tags (JSON), ranch_id (STRING(255)), model_name (STRING(255)), is_duplicate (BOOL), camera_id (STRING(255)), pipeline_version (STRING(255)), visibility (JSON), event_date (DATE), marker (JSON), event_offset_start_s (FLOAT64), risk_score (FLOAT64), death_markers (JSON), event_offset_end_s (FLOAT64), video_uri (STRING), death_markers_confidence (FLOAT64), candidate_key (STRING(255)), env (STRING(255)), quality_flags (JSON), video_start_ts (TIMESTAMP), recumbency_confidence (FLOAT64), recumbency_observed (BOOL), severity (STRING(255))
**has is_deleted: yes**
