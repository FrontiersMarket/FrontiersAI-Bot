---
name: report-generator
description: >
  Generate professional PDF reports (cattle profiles, group insights, land summaries, ranch overviews,
  and custom reports) from structured JSON data. Supports KPI cards, tables, bar charts,
  progress bars, and text sections.
---

# Report Generator

Generate multi-page PDF reports from structured JSON using `pdf-lib`. Professional blue/gray theme, automatic pagination, page numbering.

## When to Use

Trigger when the user asks for a report, PDF, document, or downloadable summary — or when data is too complex for a chat message.

## Report Types

### 1. Cattle Profile Report
Individual animal detail sheet. Include: KPI cards (weight, BCS, age, status), animal details text, weight/BCS history tables or charts, vaccination history, recent notes.

### 2. Group Insights Report
Herd/group summary. Include: KPI cards (head count, avg weight, avg BCS, active %), member list table, weight distribution or breed breakdown charts, vaccination coverage progress bars, observations text.

### 3. Land / Pasture Report
Pasture utilization overview. Include: KPI cards (pastures, total head, avg density), pasture details table, head count by pasture chart, utilization progress bars, rotation notes.

### 4. Ranch Overview Report
Full ranch summary. Include: KPI cards (total head, active %, male/female, avg weight), livestock by group chart, group metrics table, head by pasture chart, ranch goals progress, executive summary text.

### 5. Custom Dynamic Reports
Compose any layout dynamically. Start with KPIs, use charts for trends, tables for detail, text for context.

### 6. Ranch Camera Events Report
Camera-detected event overview for a specific ranch. Include: ranch info text, cameras-with-events table (videos with events, total events per camera), event type breakdown table.

## Workflow

### Step 0: Capture channel context — do this FIRST
Before anything else, extract and store:
- **Channel type**: `slack` / `discord` / etc.
- **Channel ID**: the exact channel or DM ID (e.g. `C0123456789`)
- **Thread timestamp** (if the request came in a thread): the `ts` of the parent message

If you cannot determine the channel ID from the request context, ask the user before proceeding. Do not assume or guess — uploading to the wrong channel is worse than asking.

### Step 1: Gather data
Pull all required data using the **alloydb-sync** skill before generating the report. Query exactly what the report needs — livestock records, weight history, BCS, groups, land, vaccination records, etc. Never build a report with incomplete or placeholder data.

### Step 2: Build report JSON and generate
Write the structured JSON to a temp file, run the generator, then move the output to `/tmp/` (the allowed media directory for uploads):

```bash
echo '<json_data>' > /tmp/report_data.json
node /data/workspace/skills/report-generator/report_generator.js --data_file '/tmp/report_data.json'
```

The script prints `FILE_PATH:/path/to/results/<filename>.pdf` when done. Immediately copy it to `/tmp/`:

```bash
cp <FILE_PATH> /tmp/<filename>.pdf
```

Use `/tmp/<filename>.pdf` as the upload path in Step 3.

### Step 3: Send the file to the user's channel
Upload from `/tmp/` to the channel captured in Step 0.

**Slack:**
```
message send --channel slack -t <CHANNEL_ID> --media "/tmp/<filename>.pdf" --text "<one-line summary>"
```
If in a thread:
```
message send --channel slack -t <CHANNEL_ID> --thread-id <THREAD_TS> --media "/tmp/<filename>.pdf" --text "<one-line summary>"
```

**Discord:**
```
message send --channel discord -t <CHANNEL_ID> --media "/tmp/<filename>.pdf" --text "<one-line summary>"
```

- `--media` is what triggers the file upload — do not omit it
- `--text` is the one-sentence summary shown alongside the file
- **Never** tell the user where the file is stored or reference any internal path
- **Never** ask the user to download or find the file themselves — it must arrive in the chat
- If the upload command fails, retry once before reporting an error

### Step 4: Clean up
```bash
rm -f /tmp/report_data.json /tmp/<filename>.pdf <original_FILE_PATH>
```

## Data Gathering (alloydb-sync Integration)

Before generating any report, use the **alloydb-sync** skill to fetch all needed data. Match query scope to report type:

| Report Type | Key Data to Fetch |
|-------------|-------------------|
| Cattle Profile | livestock record, weight history, BCS history, vaccinations, notes |
| Group Insights | group record, livestock list, avg weight/BCS aggregates, vaccination coverage |
| Land / Pasture | land records, livestock per pasture, head counts |
| Ranch Overview | ranch record, all groups, livestock counts, avg metrics |
| Camera Events | ranch record, cameras, video_events with counts |

Always apply `WHERE is_deleted = false` on all entity and event tables (except `ranch`). See the alloydb-sync skill for query patterns and schema reference.

## Communication Rules

**Message sequence — exactly 2 messages total:**

1. **Before any work**: Send ONE brief acknowledgement (e.g. "Generating your report…")
2. **After file upload**: The file arrives with a one-sentence summary

That's it. Nothing in between. No progress updates. No "I'll now do X". No "I found N records". No narration of tool calls or intermediate steps. Work entirely in silence between message 1 and message 2.

**On error**: Report only the actionable issue in plain language. No stack traces, no file paths, no internal details.

Never reference internal file locations, `results/` directories, or temp paths in any user-facing message.

## JSON Schema

### Top-Level Fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Report title (top of first page) |
| `subtitle` | No | Secondary line below title |
| `author` | No | Author in metadata line |
| `date` | No | Date in metadata line |
| `sections` | Yes | Array of section objects |

### Section Types

**`kpi`** — 1–4 metric cards in a row. Fields: `title`, `items[]` with `label` (req), `value` (req), `change` (opt, `+` = green, `-` = red).

**`table`** — Data table with colored header, alternating rows. Fields: `title`, `columns` (req), `rows` (req, 2D string array), `column_widths` (opt, relative proportions), `total_row` (opt, bold summary).

**`bar_chart`** — Vertical bar chart. Fields: `title`, `labels` (req), `values` (req, numeric), `prefix` (opt), `suffix` (opt).

**`horizontal_bar`** — Horizontal bar chart. Same fields as `bar_chart`.

**`progress`** — Progress bars with percentages. Fields: `title`, `items[]` with `label` (req), `value` (req, 0–100), `color` (opt: `"green"`, `"red"`, `"amber"`, or default blue).

**`text`** — Text paragraphs. Fields: `title`, `content` (supports `\n` for breaks).

**`divider`** — Horizontal line. No fields.

**`spacer`** — Vertical space. Fields: `height` (in pts).

## CLI Parameters

| Flag | Required | Description |
|------|----------|-------------|
| `--data_file` | Yes* | Path to JSON file with report data |
| `--data` | Yes* | Inline JSON string (simple reports only) |
| `--title` | No | Override title from data |
| `--subtitle` | No | Override subtitle |
| `--author` | No | Override author |
| `--date` | No | Override date |

*Provide `--data_file` or `--data`, not both. **Always prefer `--data_file`**.

## Output (internal)

On success, the generator prints:
```
<Report Title> — N page(s)
FILE_PATH:/path/to/results/<filename>.pdf
```

Parse `FILE_PATH:` to get the path, upload via `--media`, then delete the file. This path is never shared with the user.

## Design

Colors: Blue (#2161AD) primary, gray tones. Fonts: Helvetica. Page: US Letter. Auto-pagination with table header repeat. Footer: page numbers + timestamp. Charts: 8-color cycling palette.
