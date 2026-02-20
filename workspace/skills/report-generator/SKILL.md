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

See [references/report-templates.md](references/report-templates.md) for complete JSON templates for each report type.

## Workflow

### Step 0: Capture thread context
Check if the request came from a thread. If so, include thread ID in all `message send` calls:
- **Slack:** Use `--thread-id <thread_ts>` if present
- **Discord:** Use the thread channel ID as target

### Step 1: Notify the user
Send a brief "working on it" message to the same channel/thread before generating.

```
message send --channel <CHANNEL_TYPE> -t <CHANNEL_ID> [--thread-id <THREAD_TS>] --text "<message>"
```

### Step 2: Gather and prepare data
Query data (e.g., via alloydb-sync) and structure as JSON per the schema below.

### Step 3: Write JSON to temp file
```bash
echo '<json_data>' > /tmp/report_data.json
```

### Step 4: Spawn the report generator
```
subagents spawn --label report-<slug> --task "node {baseDir}/report_generator.js --data_file '/tmp/report_data.json'"
```

### Step 5: Send the result
Parse `FILE_PATH:` from output and send via the same channel/thread.
```
message send --channel <CHANNEL_TYPE> -t <CHANNEL_ID> [--thread-id <THREAD_TS>] --media "<file_path>" --text "<summary>"
```

- **Discord:** Use numeric channel ID, never `slash:` interaction IDs
- **Always** respond on the same channel/thread the user asked from

### Step 6: Clean up
```bash
rm -f /tmp/report_data.json <generated_pdf_path>
```

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

## Output

On success, prints:
```
Cattle Profile — Tag #1042 — 2 page(s)
FILE_PATH:/path/to/results/cattle_profile_tag_1042_1708300000000.pdf
```

## Design

Colors: Blue (#2161AD) primary, gray tones. Fonts: Helvetica. Page: US Letter. Auto-pagination with table header repeat. Footer: page numbers + timestamp. Charts: 8-color cycling palette.
