---
name: report-generator
description: Generates professional PDF reports with charts, tables, KPI cards, progress bars, and multi-page support. Designed as a utility skill to be invoked by other skills that need to produce formatted PDF output.
---

# Report Generator Skill

Generates a professional, multi-page PDF report from structured JSON data using `pdf-lib`. Supports KPI highlight cards, data tables, vertical and horizontal bar charts, progress bars, and text sections — all with a consistent blue/gray color theme, automatic page breaks, and page numbering.

> **This is a utility skill.** It is designed to be called by **other skills** that need to produce PDF reports. When a skill collects or processes data and needs to present it as a downloadable PDF, it should prepare a JSON data structure and invoke this skill.

## When to Use

Use this skill whenever a PDF report needs to be generated from structured data. Typical triggers:

- "Generate a report for..."
- "Create a PDF summary of..."
- "Make a report with charts showing..."
- Another skill has collected data and needs to present it as a formatted PDF

**For other skills:** If your skill produces data that should be delivered as a PDF (analytics, summaries, dashboards, metrics), prepare the data as the JSON structure documented below and invoke this skill via `subagents spawn`.

## Input — Data Structure

The report is driven by a single JSON object with a `title` and an array of `sections`. Each section has a `type` that determines how it renders.

### Top-Level Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `title` | Yes | `"Report"` | Report title (displayed prominently at top) |
| `subtitle` | No | — | Secondary line below the title |
| `author` | No | — | Author name shown in metadata line |
| `date` | No | — | Report date shown in metadata line |
| `sections` | Yes | `[]` | Array of section objects (see below) |

### Section Types

#### `kpi` — Key Performance Indicator Cards

Renders 1–4 metric cards in a row. Each card shows a large value, a label, and an optional change indicator (green ▲ for positive, red ▼ for negative).

```json
{
  "type": "kpi",
  "title": "Key Metrics",
  "items": [
    { "label": "Revenue",  "value": "$45,200", "change": "+12%" },
    { "label": "Users",    "value": "1,234",   "change": "+5.3%" },
    { "label": "Orders",   "value": "890",     "change": "-2.1%" },
    { "label": "Avg Order","value": "$50.78" }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `items[].label` | Yes | Metric name |
| `items[].value` | Yes | Display value (string — format it however you want) |
| `items[].change` | No | Change indicator. Prefix with `+` (green) or `-` (red) |

---

#### `table` — Data Table

Renders a table with a colored header row, alternating row backgrounds, and an optional bold total row. Table headers repeat on new pages if the table spans multiple pages.

```json
{
  "type": "table",
  "title": "Sales by Region",
  "columns": ["Region", "Revenue", "Orders", "Avg Order"],
  "column_widths": [2, 1, 1, 1],
  "rows": [
    ["North America", "$18,500", "342", "$54.09"],
    ["Europe",        "$12,300", "228", "$53.95"],
    ["Asia Pacific",  "$8,900",  "195", "$45.64"],
    ["Latin America", "$5,500",  "125", "$44.00"]
  ],
  "total_row": ["Total", "$45,200", "890", "$50.78"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `columns` | Yes | Array of column header strings |
| `rows` | Yes | 2D array of string cell values |
| `column_widths` | No | Relative width proportions (e.g. `[2,1,1,1]`). Defaults to first column wider |
| `total_row` | No | Bold summary row at the bottom |

---

#### `bar_chart` — Vertical Bar Chart

Renders a vertical bar chart with Y-axis grid lines, value labels above each bar, and category labels below.

```json
{
  "type": "bar_chart",
  "title": "Monthly Revenue",
  "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  "values": [45200, 38900, 52100, 48300, 55800, 61200],
  "prefix": "$"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `labels` | Yes | Category labels (keep short for best appearance) |
| `values` | Yes | Numeric values (one per label) |
| `prefix` | No | Prefix for value labels (e.g. `"$"`) |
| `suffix` | No | Suffix for value labels (e.g. `"%"`) |

---

#### `horizontal_bar` — Horizontal Bar Chart

Renders horizontal bars with labels on the left and values at the end. Best for ranked/comparison data or long category names.

```json
{
  "type": "horizontal_bar",
  "title": "Top Products",
  "labels": ["Premium Widget", "Standard Widget", "Basic Widget", "Widget Pro", "Widget Lite"],
  "values": [34000, 28000, 19500, 15200, 8700],
  "prefix": "$"
}
```

Same fields as `bar_chart`.

---

#### `progress` — Progress Bars

Renders labeled progress bars with percentage values. Supports color customization per bar.

```json
{
  "type": "progress",
  "title": "Project Completion",
  "items": [
    { "label": "Backend API",    "value": 92, "color": "green" },
    { "label": "Frontend UI",    "value": 67 },
    { "label": "Documentation",  "value": 35, "color": "amber" },
    { "label": "Testing",        "value": 15, "color": "red" }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `items[].label` | Yes | Bar label |
| `items[].value` | Yes | Percentage (0–100) |
| `items[].color` | No | `"green"`, `"red"`, `"amber"`, or omit for default blue |

---

#### `text` — Text Paragraphs

Renders a title and wrapped paragraph text. Supports newlines for paragraph breaks.

```json
{
  "type": "text",
  "title": "Executive Summary",
  "content": "This quarter showed significant growth across all regions, with total revenue increasing 12% year-over-year.\n\nKey drivers include the launch of our Premium Widget line and expansion into the Asia Pacific market."
}
```

---

#### `divider` — Horizontal Line

Renders a thin separator line. No configuration needed.

```json
{ "type": "divider" }
```

---

#### `spacer` — Vertical Space

Adds vertical whitespace between sections.

```json
{ "type": "spacer", "height": 30 }
```

## Parameters (CLI)

| Flag | Required | Description |
|------|----------|-------------|
| `--data_file` | Yes* | Path to a JSON file containing the report data |
| `--data` | Yes* | Inline JSON string with the report data |
| `--title` | No | Override the title from the data |
| `--subtitle` | No | Override the subtitle |
| `--author` | No | Override the author |
| `--date` | No | Override the date |

*Provide either `--data_file` or `--data`, not both. For complex reports, always prefer `--data_file` to avoid CLI escaping issues.

## Invocation

> **Label:** Use a unique label per invocation. Recommended pattern: `report-<topic_slug>`
> (lowercase, hyphens, no spaces). Example: topic "Monthly Sales" -> `report-monthly-sales`.

### Recommended workflow for other skills

1. **Prepare data:** Build the JSON data structure in your skill's logic
2. **Write to temp file:** Save it as a `.json` file (e.g. in `/tmp/` or in your skill's directory)
3. **Spawn this skill:** Use `subagents spawn` with `--data_file`
4. **Parse output:** Read the `FILE_PATH:` line from the subagent output
5. **Deliver:** Send the PDF via the appropriate channel

### Using --data_file (recommended for complex reports)

```
subagents spawn --label report-monthly-sales --task "node {baseDir}/report_generator.js --data_file '/tmp/report_data.json'"
```

### Using --data (for simple reports only)

```
subagents spawn --label report-quick-summary --task "node {baseDir}/report_generator.js --data '{\"title\":\"Quick Summary\",\"sections\":[{\"type\":\"text\",\"title\":\"Note\",\"content\":\"This is a quick summary.\"}]}'"
```

## Full Example

Here is a complete JSON data file that exercises all section types:

```json
{
  "title": "Q4 2025 Performance Report",
  "subtitle": "Frontiers Market — Quarterly Business Review",
  "author": "Benjamin Oliva Clariá",
  "date": "Jan 15, 2026",
  "sections": [
    {
      "type": "kpi",
      "title": "Key Metrics",
      "items": [
        { "label": "Revenue",   "value": "$182,400", "change": "+14.2%" },
        { "label": "Customers", "value": "3,847",    "change": "+8.5%" },
        { "label": "Orders",    "value": "12,390",   "change": "+11.3%" },
        { "label": "NPS Score", "value": "72",       "change": "+3" }
      ]
    },
    {
      "type": "bar_chart",
      "title": "Monthly Revenue Trend",
      "labels": ["Oct", "Nov", "Dec"],
      "values": [58200, 62100, 62100],
      "prefix": "$"
    },
    { "type": "divider" },
    {
      "type": "table",
      "title": "Revenue by Region",
      "columns": ["Region", "Revenue", "Orders", "Avg Order", "YoY Growth"],
      "column_widths": [2, 1, 1, 1, 1],
      "rows": [
        ["North America", "$72,500",  "4,820", "$15.04", "+18%"],
        ["Europe",        "$52,300",  "3,580", "$14.61", "+12%"],
        ["Asia Pacific",  "$38,100",  "2,740", "$13.91", "+9%"],
        ["Latin America", "$19,500",  "1,250", "$15.60", "+22%"]
      ],
      "total_row": ["Total", "$182,400", "12,390", "$14.72", "+14.2%"]
    },
    {
      "type": "horizontal_bar",
      "title": "Top 5 Products by Revenue",
      "labels": ["Premium Widget", "Standard Widget", "Widget Pro", "Basic Widget", "Widget Lite"],
      "values": [48200, 35600, 29100, 22800, 14500],
      "prefix": "$"
    },
    {
      "type": "progress",
      "title": "Q4 Goals Progress",
      "items": [
        { "label": "Revenue Target ($180K)",     "value": 101, "color": "green" },
        { "label": "New Customer Target (800)",  "value": 88 },
        { "label": "NPS Target (75)",            "value": 96, "color": "green" },
        { "label": "Churn Rate Target (<5%)",    "value": 42, "color": "amber" }
      ]
    },
    { "type": "divider" },
    {
      "type": "text",
      "title": "Executive Summary",
      "content": "Q4 2025 was our strongest quarter to date, exceeding the revenue target by 1.3% and achieving significant growth across all regions. Latin America led regional growth at 22% YoY, driven by expanded distribution partnerships.\n\nThe Premium Widget line continued to be our top performer, generating $48.2K in revenue. Customer satisfaction remained high with an NPS of 72, up 3 points from Q3.\n\nLooking ahead to Q1 2026, we plan to launch the Widget Ultra line and expand our Asia Pacific presence through two new retail partnerships."
    }
  ]
}
```

Spawn example:
```
subagents spawn --label report-q4-performance --task "node {baseDir}/report_generator.js --data_file '/tmp/q4_report.json'"
```

## Output

The script prints two lines on success:

```
Q4 2025 Performance Report — 1 page(s)
FILE_PATH:/path/to/results/q4_2025_performance_report_1708300000000.pdf
```

The first line is a human-readable summary. The `FILE_PATH:` line is the OpenClaw convention for file output — the system uses it to locate the generated PDF.

## Discord Delivery

When the request originates from Discord, follow this workflow:

### Step 1: Confirm before generating

```
message send --channel discord -t <CHANNEL_ID> --text "Generating report..."
```

### Step 2: Prepare data and spawn

Write the JSON data to a temp file, then spawn:
```
subagents spawn --label report-<slug> --task "node {baseDir}/report_generator.js --data_file '<json_path>'"
```

### Step 3: Deliver the result

Parse the subagent output and send:
```
message send --channel discord -t <CHANNEL_ID> --media "<file_path>" --text "<summary_line>"
```

> **Important:** Use numeric Discord channel IDs, never `slash:` interaction IDs.

## Design Details

- **Color scheme:** Professional blue (#2161AD) primary with gray tones
- **Fonts:** Helvetica / Helvetica Bold (built into pdf-lib, no external fonts needed)
- **Page size:** US Letter (612 x 792 pts)
- **Auto pagination:** Content flows across pages automatically; tables re-draw headers on new pages
- **Page footer:** Page numbers (right) and generation timestamp (left) on every page
- **Section titles:** Blue accent marker for visual hierarchy
- **Chart colors:** 8-color palette that cycles for bars (blue, green, amber, red, purple, orange, teal, magenta)
- **KPI cards:** Light blue background with left accent strip, large value, small label, and colored change arrows

## Dependencies

- **Runtime:** Node.js
- **Package:** `pdf-lib` (installed via `package.json`)

## Files

```
skills/report-generator/
├── report_generator.js        # Main script — builds PDF from JSON data
├── package.json               # Dependencies (pdf-lib)
├── package-lock.json
├── results/                   # Generated reports are stored here
└── SKILL.md                   # This file
```
