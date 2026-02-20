# Report Templates

Complete JSON templates for each report type. Copy and adapt — replace placeholder values with real data from BigQuery queries.

---

## 1. Cattle Profile Report

Individual animal detail sheet. Pull data from `public_livestock` + record tables.

```json
{
  "title": "Cattle Profile — Tag #1042",
  "subtitle": "Green Valley Ranch",
  "author": "Frontiers Bot",
  "date": "Feb 20, 2026",
  "sections": [
    {
      "type": "kpi",
      "title": "At a Glance",
      "items": [
        { "label": "Current Weight", "value": "1,240 lbs", "change": "+30" },
        { "label": "Latest BCS", "value": "6.5", "change": "+0.5" },
        { "label": "Age", "value": "3y 4m" },
        { "label": "Status", "value": "Active" }
      ]
    },
    {
      "type": "text",
      "title": "Animal Details",
      "content": "Name: Bella\nBreed: Angus\nSex: Female\nDate of Birth: Oct 12, 2022\nSire: Tag #0801 (Thunder)\nDam: Tag #0445 (Rosie)\nGroup: Breeding Heifers\nPasture: North Pasture"
    },
    { "type": "divider" },
    {
      "type": "bar_chart",
      "title": "Weight Trend",
      "labels": ["Mar 25", "May 25", "Jul 25", "Sep 25", "Nov 25", "Jan 26"],
      "values": [1080, 1120, 1150, 1185, 1210, 1240],
      "suffix": " lbs"
    },
    {
      "type": "table",
      "title": "Weight Records",
      "columns": ["Date", "Weight (lbs)", "Change", "Notes"],
      "column_widths": [1.5, 1, 1, 2],
      "rows": [
        ["2026-01-15", "1,240", "+30", "Winter check"],
        ["2025-11-20", "1,210", "+25", "Fall roundup"],
        ["2025-09-10", "1,185", "+35", "Post-summer"],
        ["2025-07-05", "1,150", "+30", "Mid-summer"],
        ["2025-05-01", "1,120", "+40", "Spring weigh-in"],
        ["2025-03-10", "1,080", "—", "Baseline"]
      ]
    },
    { "type": "divider" },
    {
      "type": "table",
      "title": "BCS History",
      "columns": ["Date", "Score", "Notes"],
      "column_widths": [1.5, 1, 3],
      "rows": [
        ["2026-01-15", "6.5", "Good condition, slightly above target"],
        ["2025-11-20", "6.0", "On track"],
        ["2025-09-10", "5.5", "Needs monitoring"],
        ["2025-07-05", "5.5", "Stable"]
      ]
    },
    {
      "type": "table",
      "title": "Vaccination History",
      "columns": ["Date", "Vaccine", "Dose", "Administered By"],
      "column_widths": [1.5, 2, 1, 1.5],
      "rows": [
        ["2025-12-01", "Blackleg (7-way)", "2ml", "Dr. Martinez"],
        ["2025-12-01", "BVD", "2ml", "Dr. Martinez"],
        ["2025-06-15", "Brucellosis", "2ml", "Dr. Chen"],
        ["2025-03-10", "Dewormer (Ivermectin)", "10ml", "Ranch staff"]
      ]
    },
    {
      "type": "table",
      "title": "Recent Notes",
      "columns": ["Date", "Author", "Note"],
      "column_widths": [1.5, 1.5, 4],
      "rows": [
        ["2026-01-15", "Ben O.", "Good weight gain through winter. Ready for spring breeding."],
        ["2025-11-20", "Dr. Martinez", "Healthy, no concerns. Vaccinations up to date."],
        ["2025-09-10", "Ranch staff", "Moved from East Meadow to North Pasture for better forage."]
      ]
    }
  ]
}
```

---

## 2. Group Insights Report

Herd/group summary. Pull from `public_livestock` + `public_group` + latest records.

```json
{
  "title": "Group Insights — Breeding Heifers",
  "subtitle": "Green Valley Ranch",
  "author": "Frontiers Bot",
  "date": "Feb 20, 2026",
  "sections": [
    {
      "type": "kpi",
      "title": "Group Summary",
      "items": [
        { "label": "Head Count", "value": "124" },
        { "label": "Avg Weight", "value": "1,185 lbs" },
        { "label": "Avg BCS", "value": "5.8" },
        { "label": "Active %", "value": "96.8%", "change": "+1.2%" }
      ]
    },
    {
      "type": "bar_chart",
      "title": "Weight Distribution",
      "labels": ["<1000", "1000-1100", "1100-1200", "1200-1300", "1300+"],
      "values": [8, 22, 45, 38, 11],
      "suffix": " head"
    },
    {
      "type": "horizontal_bar",
      "title": "Breed Breakdown",
      "labels": ["Angus", "Hereford", "Angus x Hereford", "Charolais", "Other"],
      "values": [52, 28, 24, 12, 8]
    },
    { "type": "divider" },
    {
      "type": "progress",
      "title": "Vaccination Coverage",
      "items": [
        { "label": "Blackleg (7-way)", "value": 98, "color": "green" },
        { "label": "BVD", "value": 92, "color": "green" },
        { "label": "Brucellosis", "value": 78 },
        { "label": "Leptospirosis", "value": 45, "color": "amber" }
      ]
    },
    { "type": "divider" },
    {
      "type": "table",
      "title": "Group Members",
      "columns": ["Tag", "Name", "Breed", "Status", "Weight (lbs)", "BCS"],
      "column_widths": [1, 1.5, 1.5, 1, 1, 0.8],
      "rows": [
        ["#1042", "Bella", "Angus", "Active", "1,240", "6.5"],
        ["#1043", "Duke", "Hereford", "Active", "1,380", "6.0"],
        ["#1044", "Misty", "Angus", "Active", "1,150", "5.5"],
        ["#1045", "Storm", "Charolais", "Active", "1,290", "6.0"],
        ["...", "...", "...", "...", "...", "..."]
      ],
      "total_row": ["124 total", "", "", "120 active", "Avg: 1,185", "Avg: 5.8"]
    },
    {
      "type": "text",
      "title": "Observations",
      "content": "The Breeding Heifers group shows strong overall condition heading into spring. Average weight gain has been consistent at ~25 lbs/month over the last quarter.\n\nLeptospirosis vaccination coverage is below target — 68 animals still need their dose. Recommend scheduling a round-up within the next 2 weeks.\n\n4 animals have BCS below 5 and should be moved to supplemental feed."
    }
  ]
}
```

---

## 3. Land / Pasture Report

Pasture utilization overview. Pull from `public_land` + livestock counts.

```json
{
  "title": "Land & Pasture Report",
  "subtitle": "Green Valley Ranch",
  "author": "Frontiers Bot",
  "date": "Feb 20, 2026",
  "sections": [
    {
      "type": "kpi",
      "title": "Overview",
      "items": [
        { "label": "Total Pastures", "value": "6" },
        { "label": "Total Acreage", "value": "2,840 ac" },
        { "label": "Total Head", "value": "847" },
        { "label": "Avg Density", "value": "3.4 hd/ac" }
      ]
    },
    {
      "type": "horizontal_bar",
      "title": "Head Count by Pasture",
      "labels": ["East Meadow", "North Pasture", "South Field", "River Bottom", "Bull Lot", "Quarantine"],
      "values": [312, 245, 198, 62, 24, 6]
    },
    { "type": "divider" },
    {
      "type": "table",
      "title": "Pasture Details",
      "columns": ["Pasture", "Area (ac)", "Head Count", "Density (hd/ac)", "Capacity", "Utilization"],
      "column_widths": [2, 1, 1, 1, 1, 1],
      "rows": [
        ["East Meadow", "850", "312", "2.7", "350", "89%"],
        ["North Pasture", "680", "245", "2.8", "280", "88%"],
        ["South Field", "640", "198", "3.2", "250", "79%"],
        ["River Bottom", "420", "62", "6.8", "100", "62%"],
        ["Bull Lot", "150", "24", "6.3", "40", "60%"],
        ["Quarantine", "100", "6", "16.7", "20", "30%"]
      ],
      "total_row": ["Total", "2,840", "847", "3.4 avg", "1,040", "81% avg"]
    },
    {
      "type": "progress",
      "title": "Pasture Utilization",
      "items": [
        { "label": "East Meadow", "value": 89 },
        { "label": "North Pasture", "value": 88 },
        { "label": "South Field", "value": 79 },
        { "label": "River Bottom", "value": 62, "color": "amber" },
        { "label": "Bull Lot", "value": 60, "color": "amber" },
        { "label": "Quarantine", "value": 30, "color": "green" }
      ]
    },
    {
      "type": "text",
      "title": "Notes",
      "content": "East Meadow and North Pasture are approaching capacity. Consider rotating ~50 head from East Meadow to River Bottom, which has significant available capacity.\n\nQuarantine pen currently holding 6 animals (2 new arrivals, 4 under observation). Expected to clear within 10 days."
    }
  ]
}
```

---

## 4. Ranch Overview Report

Full ranch summary. Aggregates across all groups, pastures, and records.

```json
{
  "title": "Ranch Overview Report",
  "subtitle": "Green Valley Ranch — Monthly Summary",
  "author": "Frontiers Bot",
  "date": "Feb 20, 2026",
  "sections": [
    {
      "type": "kpi",
      "title": "Ranch at a Glance",
      "items": [
        { "label": "Total Head", "value": "847", "change": "+23" },
        { "label": "Active", "value": "802 (94.7%)" },
        { "label": "Avg Weight", "value": "1,165 lbs", "change": "+18" },
        { "label": "Avg BCS", "value": "5.9", "change": "+0.2" }
      ]
    },
    {
      "type": "kpi",
      "items": [
        { "label": "Males", "value": "389 (45.9%)" },
        { "label": "Females", "value": "458 (54.1%)" },
        { "label": "Sold (YTD)", "value": "34" },
        { "label": "Deceased (YTD)", "value": "11" }
      ]
    },
    { "type": "divider" },
    {
      "type": "bar_chart",
      "title": "Head Count by Group",
      "labels": ["Breeding Heifers", "Cow-Calf", "Stocker", "Bulls", "Calves", "Other"],
      "values": [124, 210, 185, 48, 245, 35]
    },
    {
      "type": "table",
      "title": "Group Metrics",
      "columns": ["Group", "Count", "Avg Weight", "Avg BCS", "Vax %"],
      "column_widths": [2, 1, 1, 1, 1],
      "rows": [
        ["Breeding Heifers", "124", "1,185 lbs", "5.8", "92%"],
        ["Cow-Calf Pairs", "210", "1,220 lbs", "6.1", "96%"],
        ["Stockers", "185", "980 lbs", "5.5", "88%"],
        ["Bulls", "48", "1,650 lbs", "6.4", "100%"],
        ["Calves", "245", "450 lbs", "—", "78%"],
        ["Other", "35", "1,100 lbs", "5.6", "85%"]
      ],
      "total_row": ["Total", "847", "1,165 avg", "5.9 avg", "90% avg"]
    },
    { "type": "divider" },
    {
      "type": "horizontal_bar",
      "title": "Head by Pasture",
      "labels": ["East Meadow", "North Pasture", "South Field", "River Bottom", "Bull Lot", "Quarantine"],
      "values": [312, 245, 198, 62, 24, 6]
    },
    {
      "type": "progress",
      "title": "Ranch Goals",
      "items": [
        { "label": "Target Head Count (900)", "value": 94 },
        { "label": "Avg Weight Target (1,200 lbs)", "value": 97, "color": "green" },
        { "label": "Full Vaccination Coverage", "value": 90 },
        { "label": "Pasture Rotation Plan", "value": 65, "color": "amber" }
      ]
    },
    {
      "type": "text",
      "title": "Executive Summary",
      "content": "The ranch is performing well across all key metrics this month. Total head count is approaching our 900 target with 23 new additions (calves + acquisitions) this period.\n\nWeight gain trends remain positive across all groups, with stockers showing the strongest monthly gain at 35 lbs/month average. BCS scores are stable or improving.\n\nPrimary action items:\n• Complete leptospirosis vaccination round for calves (78% → target 95%)\n• Rotate 50 head from East Meadow to River Bottom to balance utilization\n• Schedule spring breeding for Breeding Heifers group (124 head)"
    }
  ]
}
```

---

## 5. Custom Dynamic Report — Construction Guide

For non-standard requests, compose sections dynamically based on available data.

### Pattern: Data summary with trends

```json
{
  "title": "<Descriptive Title>",
  "subtitle": "<Ranch Name> — <Context>",
  "author": "Frontiers Bot",
  "date": "<Current Date>",
  "sections": [
    { "type": "kpi", "title": "Key Metrics", "items": [ "..." ] },
    { "type": "bar_chart", "title": "Trend / Comparison", "..." : "..." },
    { "type": "divider" },
    { "type": "table", "title": "Detailed Data", "..." : "..." },
    { "type": "text", "title": "Summary", "content": "..." }
  ]
}
```

### Pattern: Comparison report

```json
{
  "title": "...",
  "sections": [
    { "type": "kpi", "items": ["metric A vs B..."] },
    { "type": "horizontal_bar", "title": "Side-by-side comparison" },
    { "type": "table", "title": "Detailed comparison table" },
    { "type": "text", "title": "Analysis" }
  ]
}
```

### Tips for composing dynamic reports

- **Start with KPIs** — the most important 3–4 numbers at the top
- **Charts before tables** — visual overview first, then detailed data
- **Use dividers** between logical sections
- **End with text** — summary, recommendations, or next steps
- **Title should be specific** — "Weight Trends Q4 2025" not "Report"
- **Always include date** — use current date
- **Keep tables under 20 rows** — summarize larger datasets, note total count
