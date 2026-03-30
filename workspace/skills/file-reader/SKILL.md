---
name: file-reader
description: >
  Parse uploaded files (XLSX, DOCX, CSV) that the built-in tools cannot read.
  Use when a user uploads a spreadsheet or Word document and you need to
  extract its contents. PDFs and images are handled natively — do NOT use
  this skill for those.
---

# File Reader Skill

## When to use

- User uploads an `.xlsx` or `.xls` file → use openpyxl
- User uploads a `.docx` file → use python-docx
- User uploads a `.csv` file → use pandas or the read tool directly

**Do NOT use for:**
- PDF files → handled natively by the PDF tool
- Images → handled natively by media understanding
- Plain text / CSV → use the `read` tool directly

## How it works

Files uploaded via Slack are downloaded to the media store. The file path is
available in the message context. Use the Python venv to parse.

## XLSX / XLS (Excel)

```bash
/opt/dataviz-venv/bin/python3 -c "
import openpyxl, json, sys

wb = openpyxl.load_workbook('FILE_PATH', read_only=True, data_only=True)
for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    rows = []
    headers = None
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c) if c else f'col_{j}' for j, c in enumerate(row)]
            continue
        rows.append(dict(zip(headers, [str(c) if c is not None else '' for c in row])))
    print(f'Sheet: {sheet_name} ({len(rows)} rows)')
    print(json.dumps(rows[:50], indent=2))
"
```

Replace `FILE_PATH` with the actual path. Limit output to first 50 rows —
summarize for the user and offer more detail on request.

## DOCX (Word)

```bash
/opt/dataviz-venv/bin/python3 -c "
from docx import Document

doc = Document('FILE_PATH')
for para in doc.paragraphs:
    if para.text.strip():
        print(para.text)
"
```

For tables in DOCX:

```bash
/opt/dataviz-venv/bin/python3 -c "
from docx import Document
import json

doc = Document('FILE_PATH')
for i, table in enumerate(doc.tables):
    headers = [cell.text for cell in table.rows[0].cells]
    rows = []
    for row in table.rows[1:]:
        rows.append(dict(zip(headers, [cell.text for cell in row.cells])))
    print(f'Table {i+1}: {len(rows)} rows')
    print(json.dumps(rows[:20], indent=2))
"
```

## CSV (fallback)

```bash
/opt/dataviz-venv/bin/python3 -c "
import pandas as pd, json
df = pd.read_csv('FILE_PATH')
print(f'{len(df)} rows, {len(df.columns)} columns')
print('Columns:', list(df.columns))
print(json.dumps(df.head(20).to_dict(orient='records'), indent=2, default=str))
"
```

## Response rules

- Summarize the file contents — don't dump raw data
- For large spreadsheets, show column names + row count + first few rows
- Offer to dig into specific columns or sheets
- Follow platform formatting rules (AGENTS.md)
- Never expose file paths to the user
