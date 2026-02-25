#!/usr/bin/env python3
import json
import subprocess
import sys
from datetime import datetime

def run_bq_query(query):
    command = [
        "bq", "query",
        "--project_id=frontiersmarketplace",
        "--use_legacy_sql=false",
        "--format=json",
        query
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)

def main(ranch_name):
    # 1. Get ranch UUID
    ranch_uuid_query = f"""
        SELECT uuid, ranch_name, city, state
        FROM `frontiersmarketplace.public.ranch`
        WHERE LOWER(ranch_name) = LOWER('{ranch_name}')
        LIMIT 1
    """
    ranch_info = run_bq_query(ranch_uuid_query)
    if not ranch_info:
        print(f"Error: Ranch '{ranch_name}' not found.", file=sys.stderr)
        sys.exit(1)
    
    ranch_uuid = ranch_info[0]['uuid']
    full_ranch_name = ranch_info[0]['ranch_name']
    ranch_city = ranch_info[0]['city']
    ranch_state = ranch_info[0]['state']

    # 2. Get Camera Events Summary
    camera_events_query = f"""
        SELECT
            c.display_name AS camera_name,
            COUNT(DISTINCT ve.video_uuid) AS videos_with_events,
            COUNT(ve.uuid) AS total_events_per_camera
        FROM
            `frontiersmarketplace.public.cameras` AS c
        JOIN
            `frontiersmarketplace.public.video_events` AS ve
        ON
            c.uuid = ve.camera_id
        WHERE
            c.ranch_uuid = '{ranch_uuid}'
            AND c.is_deleted = FALSE
            AND ve.is_deleted = FALSE
        GROUP BY
            c.display_name
        HAVING
            COUNT(ve.uuid) > 0
        ORDER BY
            c.display_name
    """
    camera_events_summary = run_bq_query(camera_events_query)

    # 3. Get Events by Type for Pie Chart (table representation)
    event_type_query = f"""
        SELECT
            event_type,
            COUNT(uuid) AS event_count
        FROM
            `frontiersmarketplace.public.video_events`
        WHERE
            ranch_id = '{ranch_uuid}'
            AND is_deleted = FALSE
        GROUP BY
            event_type
        ORDER BY
            event_count DESC
    """
    event_type_data = run_bq_query(event_type_query)

    total_ranch_events = sum(int(item['event_count']) for item in event_type_data)

    event_type_table_rows = []
    for item in event_type_data:
        event_type = item['event_type']
        count = int(item['event_count'])
        percentage = (count / total_ranch_events) * 100 if total_ranch_events > 0 else 0
        event_type_table_rows.append([event_type, str(count), f"{percentage:.2f}%" if total_ranch_events > 0 else "0.00%"])

    # Prepare data for camera events table
    camera_table_rows = []
    total_cameras_with_events = len(camera_events_summary)
    total_events_across_cameras = 0
    for camera in camera_events_summary:
        camera_table_rows.append([
            camera['camera_name'],
            str(camera['videos_with_events']),
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
                "columns": ["Camera Name", "Videos with Events", "Total Events"],
                "rows": camera_table_rows,
                "total_row": [f"Total Cameras with Events: {total_cameras_with_events}", "", f"Total Events: {total_events_across_cameras}"]
            },
            {
                "type": "text",
                "title": "Event Type Distribution",
                "content": "A pie chart for event type distribution would typically be displayed here. Below is a table summarizing event types and their percentages of total events across the ranch."
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
    if len(sys.argv) < 2:
        print("Usage: generate_camera_events_report.py <ranch_name>", file=sys.stderr)
        sys.exit(1)
    
    ranch_name = sys.argv[1]
    main(ranch_name)
