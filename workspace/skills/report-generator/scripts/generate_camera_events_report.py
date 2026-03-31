#!/usr/bin/env python3
"""Generate camera events report data from local SQLite DB.

Uses confirmed_events (v2) — NOT video_events (deprecated).
Queries the local ranch-scoped database, not BigQuery directly.
"""
import json
import subprocess
import sys
from datetime import datetime

DB_PATH = "/data/ranch_data.db"

def run_sql(query):
    result = subprocess.run(
        ["sqlite3", "-json", DB_PATH, query],
        capture_output=True, text=True, check=True
    )
    output = result.stdout.strip()
    return json.loads(output) if output else []

def main():
    # 1. Get ranch info (single row — DB is pre-scoped)
    ranch_info = run_sql("""
        SELECT ranch_name, city, state FROM ranch LIMIT 1
    """)
    if not ranch_info:
        print("Error: No ranch found in local DB.", file=sys.stderr)
        sys.exit(1)

    ranch = ranch_info[0]
    full_ranch_name = ranch['ranch_name']
    ranch_city = ranch.get('city', '')
    ranch_state = ranch.get('state', '')

    # 2. Camera events summary (confirmed_events joined to cameras)
    camera_events_summary = run_sql("""
        SELECT
            COALESCE(c.display_name, c.name) AS camera_name,
            COUNT(DISTINCT ce.date_str) AS days_with_events,
            COUNT(ce.event_id) AS total_events_per_camera
        FROM confirmed_events ce
        LEFT JOIN cameras c ON c.name = ce.camera_name AND c.is_deleted = 0
        GROUP BY ce.camera_name
        HAVING COUNT(ce.event_id) > 0
        ORDER BY camera_name
    """)

    # 3. Events by type
    event_type_data = run_sql("""
        SELECT
            event_type,
            COUNT(event_id) AS event_count
        FROM confirmed_events
        GROUP BY event_type
        ORDER BY event_count DESC
    """)

    total_ranch_events = sum(int(item['event_count']) for item in event_type_data)

    event_type_table_rows = []
    for item in event_type_data:
        event_type = item['event_type']
        count = int(item['event_count'])
        percentage = (count / total_ranch_events) * 100 if total_ranch_events > 0 else 0
        event_type_table_rows.append([
            event_type, str(count),
            f"{percentage:.2f}%" if total_ranch_events > 0 else "0.00%"
        ])

    # Prepare camera events table
    camera_table_rows = []
    total_cameras_with_events = len(camera_events_summary)
    total_events_across_cameras = 0
    for camera in camera_events_summary:
        camera_table_rows.append([
            camera['camera_name'],
            str(camera['days_with_events']),
            str(camera['total_events_per_camera'])
        ])
        total_events_across_cameras += int(camera['total_events_per_camera'])

    report_data = {
        "title": f"Ranch Camera Events Report - {full_ranch_name}",
        "subtitle": f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "sections": [
            {
                "type": "text",
                "title": "Ranch Information",
                "content": f"Ranch: {full_ranch_name}\nLocation: {ranch_city}, {ranch_state}"
            },
            {
                "type": "table",
                "title": "Cameras with Detected Events",
                "columns": ["Camera Name", "Days with Events", "Total Events"],
                "rows": camera_table_rows,
                "total_row": [
                    f"Total Cameras: {total_cameras_with_events}",
                    "",
                    f"Total Events: {total_events_across_cameras}"
                ]
            },
            {
                "type": "text",
                "title": "Event Type Distribution",
                "content": "Summary of ML-detected event types across all cameras."
            },
            {
                "type": "table",
                "title": "Event Type Breakdown",
                "columns": ["Event Type", "Count", "Percentage"],
                "rows": event_type_table_rows
            }
        ]
    }

    print(json.dumps(report_data, indent=2))

if __name__ == "__main__":
    main()
