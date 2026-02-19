---
name: ranch
description: Generate a PDF report summarizing ranch operations with mocked data.
user-invocable: true
metadata: {"openclaw": {"emoji": "🐄", "requires": {"anyBins": ["python", "python3"]}}}
---

# Ranch Report Generator

Generate a PDF report summarizing ranch operations with mocked data.

## Trigger

When the user asks for a "ranch report", "ranch PDF", or "generate ranch summary".

## How It Works

Use the code execution tool to generate a PDF with the mocked data below. Write a Python script that uses only the standard library (`reportlab` is NOT guaranteed — use the approach below).

### PDF Generation (no dependencies)

Generate the PDF using **FPDF-style manual binary construction** or, if available, `reportlab`. The safest approach is to write raw PDF bytes:

```python
import struct, datetime, os

def generate_ranch_pdf(output_path):
    """Generate a ranch report PDF from mocked data."""

    data = MOCK_DATA  # defined below

    # Use reportlab if available, otherwise fall back to minimal PDF writer
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors

        doc = SimpleDocTemplate(output_path, pagesize=letter)
        styles = getSampleStyleSheet()
        elements = []

        # Title
        elements.append(Paragraph(f"<b>{data['name']}</b> — Monthly Report", styles["Title"]))
        elements.append(Paragraph(f"Report Date: {data['report_date']}", styles["Normal"]))
        elements.append(Spacer(1, 0.3 * inch))

        # Overview
        elements.append(Paragraph("<b>Overview</b>", styles["Heading2"]))
        elements.append(Paragraph(f"Location: {data['location']}", styles["Normal"]))
        elements.append(Paragraph(f"Total Acreage: {data['total_acres']} acres", styles["Normal"]))
        elements.append(Paragraph(f"Manager: {data['manager']}", styles["Normal"]))
        elements.append(Spacer(1, 0.2 * inch))

        # Livestock table
        elements.append(Paragraph("<b>Livestock Inventory</b>", styles["Heading2"]))
        livestock_rows = [["Type", "Head Count", "Avg Weight (lbs)", "Health Status"]]
        for item in data["livestock"]:
            livestock_rows.append([item["type"], str(item["count"]), str(item["avg_weight"]), item["health"]])
        t = Table(livestock_rows, colWidths=[1.5*inch, 1.2*inch, 1.5*inch, 1.5*inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4472C4")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
        ]))
        elements.append(t)
        elements.append(Spacer(1, 0.2 * inch))

        # Pastures table
        elements.append(Paragraph("<b>Pasture Status</b>", styles["Heading2"]))
        pasture_rows = [["Pasture", "Acres", "Condition", "Current Use"]]
        for p in data["pastures"]:
            pasture_rows.append([p["name"], str(p["acres"]), p["condition"], p["use"]])
        t2 = Table(pasture_rows, colWidths=[1.5*inch, 1*inch, 1.2*inch, 2*inch])
        t2.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#548235")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
        ]))
        elements.append(t2)
        elements.append(Spacer(1, 0.2 * inch))

        # Financials
        elements.append(Paragraph("<b>Financial Summary (Monthly)</b>", styles["Heading2"]))
        fin = data["financials"]
        fin_rows = [["Category", "Amount (USD)"]]
        for key, val in fin.items():
            label = key.replace("_", " ").title()
            prefix = "-$" if "expense" in key or "cost" in key else "$"
            fin_rows.append([label, f"{prefix}{abs(val):,.2f}"])
        t3 = Table(fin_rows, colWidths=[3*inch, 2*inch])
        t3.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#BF8F00")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        elements.append(t3)
        elements.append(Spacer(1, 0.2 * inch))

        # Notes
        elements.append(Paragraph("<b>Notes</b>", styles["Heading2"]))
        for note in data["notes"]:
            elements.append(Paragraph(f"• {note}", styles["Normal"]))

        doc.build(elements)

    except ImportError:
        # Fallback: minimal plain-text PDF
        lines = []
        lines.append(f"{data['name']} - Monthly Report")
        lines.append(f"Date: {data['report_date']}  |  Location: {data['location']}")
        lines.append(f"Manager: {data['manager']}  |  Acreage: {data['total_acres']}")
        lines.append("")
        lines.append("LIVESTOCK")
        for item in data["livestock"]:
            lines.append(f"  {item['type']}: {item['count']} head, ~{item['avg_weight']}lb, {item['health']}")
        lines.append("")
        lines.append("PASTURES")
        for p in data["pastures"]:
            lines.append(f"  {p['name']}: {p['acres']}ac, {p['condition']}, {p['use']}")
        lines.append("")
        lines.append("FINANCIALS")
        fin = data["financials"]
        for key, val in fin.items():
            lines.append(f"  {key.replace('_',' ').title()}: ${val:,.2f}")
        lines.append("")
        lines.append("NOTES")
        for note in data["notes"]:
            lines.append(f"  - {note}")

        text = "\n".join(lines)

        # Write minimal valid PDF with text
        with open(output_path, "wb") as f:
            f.write(b"%PDF-1.4\n")
            # Minimal PDF with one page of text
            stream = f"BT /F1 10 Tf 50 750 Td ({text[:2000].replace(chr(10), ') Tj T* (')}) Tj ET"
            stream_bytes = stream.encode("latin-1", errors="replace")
            objects = []
            # Catalog
            objects.append(b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n")
            # Pages
            objects.append(b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n")
            # Page
            objects.append(b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n")
            # Stream
            objects.append(f"4 0 obj<</Length {len(stream_bytes)}>>stream\n".encode() + stream_bytes + b"\nendstream endobj\n")
            # Font
            objects.append(b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Courier>>endobj\n")

            offsets = []
            for obj in objects:
                offsets.append(f.tell())
                f.write(obj)
            xref_pos = f.tell()
            f.write(b"xref\n")
            f.write(f"0 {len(objects)+1}\n".encode())
            f.write(b"0000000000 65535 f \n")
            for off in offsets:
                f.write(f"{off:010d} 00000 g \n".encode())
            f.write(b"trailer\n")
            f.write(f"<</Size {len(objects)+1}/Root 1 0 R>>\n".encode())
            f.write(b"startxref\n")
            f.write(f"{xref_pos}\n".encode())
            f.write(b"%%EOF\n")

    return output_path
```

## Mocked Data

```python
MOCK_DATA = {
    "name": "El Rancho Grande",
    "location": "Hill Country, TX",
    "total_acres": 2400,
    "manager": "Carlos Mendoza",
    "report_date": datetime.date.today().strftime("%B %d, %Y"),
    "livestock": [
        {"type": "Angus Cattle",   "count": 185, "avg_weight": 1150, "health": "Good"},
        {"type": "Hereford Cattle", "count": 60, "avg_weight": 1080, "health": "Good"},
        {"type": "Horses",         "count": 12,  "avg_weight": 1000, "health": "Excellent"},
        {"type": "Goats",          "count": 45,  "avg_weight": 135,  "health": "Fair — 3 under vet watch"},
        {"type": "Chickens",       "count": 200, "avg_weight": 6,    "health": "Good"},
    ],
    "pastures": [
        {"name": "North Ridge",    "acres": 600, "condition": "Excellent", "use": "Angus grazing"},
        {"name": "Creek Bottom",   "acres": 450, "condition": "Good",      "use": "Hereford grazing"},
        {"name": "West Hill",      "acres": 350, "condition": "Fair",      "use": "Resting (reseeded)"},
        {"name": "East Meadow",    "acres": 500, "condition": "Good",      "use": "Hay production"},
        {"name": "South Pen",      "acres": 100, "condition": "Good",      "use": "Goats & chickens"},
        {"name": "Homestead",      "acres": 400, "condition": "Excellent", "use": "Horses / facilities"},
    ],
    "financials": {
        "cattle_sales":       48500.00,
        "hay_sales":           6200.00,
        "egg_sales":           1800.00,
        "feed_expense":      -12400.00,
        "veterinary_expense": -3200.00,
        "labor_cost":        -15000.00,
        "equipment_cost":     -2800.00,
        "misc_expense":       -1600.00,
    },
    "notes": [
        "3 goats showing signs of respiratory infection — vet scheduled for Thursday.",
        "West Hill pasture reseeded with bermuda grass; expect 6-week rest period.",
        "New hay baler delivered; old unit listed for sale at $4,500.",
        "Water well #2 pump replaced — flow rate back to normal.",
        "Planning to move 40 head of Angus to Creek Bottom next month after rotation.",
    ],
}
```

## Usage

Generate the report to the workspace and share the file:

```python
import datetime

output_path = "/tmp/ranch_report.pdf"
generate_ranch_pdf(output_path)
print(f"Report saved to {output_path}")
```

Then send the PDF file to the user.
