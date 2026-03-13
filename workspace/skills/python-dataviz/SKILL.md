---
name: python-dataviz
description: Generate charts and visualizations using Python + plotly. Use when user asks for chart, graph, plot, or visualization.
---

# Python Data Visualization

## CRITICAL: Python Environment

**ALWAYS use `/opt/dataviz-venv/bin/python3`** — NEVER use `python3` directly. The system python has no packages.

```bash
/opt/dataviz-venv/bin/python3 --version  # should print Python 3.x
```

Available packages in the venv: `plotly`, `kaleido==0.2.1`, `pandas`, `numpy`, `matplotlib`, `seaborn`.

**kaleido 0.2.1 is self-contained** (no Chrome needed). Do NOT upgrade it — kaleido 1.x requires Chromium which is NOT installed.

---

## How to Generate and Deliver a Chart

**Do this in a SINGLE exec call** — do NOT send any Slack message before the chart is uploaded. Sending a message ends your turn on Slack.

### Full Template

```bash
/opt/dataviz-venv/bin/python3 - << 'PYEOF'
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import os, json, urllib.request, urllib.parse

# ── 1. BUILD YOUR CHART ────────────────────────────────────────────────────
# Replace this example data with actual data from local-db
data = [
    {"group": "Example A", "count": 10},
    {"group": "Example B", "count": 20},
]
df = pd.DataFrame(data)

fig = px.bar(
    df, x="group", y="count", text="count",
    title="Your Chart Title",
    template="plotly_dark",
    color_discrete_sequence=px.colors.qualitative.Vivid,
    labels={"group": "Group", "count": "Count"},
)
fig.update_traces(texttemplate="%{text}", textposition="outside")
fig.update_layout(font=dict(size=14), margin=dict(t=60, b=60, l=60, r=30))

# Save PNG
media_dir = os.path.join(os.environ.get("OPENCLAW_STATE_DIR", "/data/.openclaw"), "media")
os.makedirs(media_dir, exist_ok=True)
output_path = os.path.join(media_dir, "chart.png")
fig.write_image(output_path, width=1200, height=700, scale=2)
print(f"Chart saved: {output_path} ({os.path.getsize(output_path)} bytes)")

# ── 2. UPLOAD TO SLACK ─────────────────────────────────────────────────────
# Set these from Conversation info:
CHANNEL_ID = "REPLACE_WITH_channel_id_or_sender_id"  # C..., D..., or U...
THREAD_TS  = "REPLACE_WITH_ts_or_thread_ts"  # ALWAYS set — use ts/thread_ts from Conversation info to reply in thread
SERVICE    = "slack"   # "slack" or "imessage"
SENDER_ID  = ""        # iMessage only

if SERVICE == "slack":
    state_dir = os.environ.get("OPENCLAW_STATE_DIR", "/data/.openclaw")
    cfg = json.load(open(os.path.join(state_dir, "openclaw.json")))
    token = cfg["channels"]["slack"]["botToken"]

    def post_form(endpoint, payload):
        data = urllib.parse.urlencode(payload).encode()
        req = urllib.request.Request(f"https://slack.com/api/{endpoint}", data=data,
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def post_json(endpoint, payload):
        data = json.dumps(payload).encode()
        req = urllib.request.Request(f"https://slack.com/api/{endpoint}", data=data,
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    # Auto-resolve user ID (U...) to DM channel ID (D...)
    channel_id = CHANNEL_ID
    if channel_id.startswith("U"):
        open_resp = post_json("conversations.open", {"users": channel_id})
        assert open_resp["ok"], f"conversations.open failed: {open_resp}"
        channel_id = open_resp["channel"]["id"]
        print(f"Resolved {CHANNEL_ID} → DM channel {channel_id}")

    filename = os.path.basename(output_path)
    filesize = os.path.getsize(output_path)

    resp = post_form("files.getUploadURLExternal", {"filename": filename, "length": filesize})
    assert resp["ok"], f"getUploadURL failed: {resp}"

    with open(output_path, "rb") as f:
        req = urllib.request.Request(resp["upload_url"], data=f.read(),
            headers={"Content-Type": "application/octet-stream"}, method="POST")
        urllib.request.urlopen(req).read()

    complete = {"files": [{"id": resp["file_id"]}], "channel_id": channel_id}
    if THREAD_TS:
        complete["thread_ts"] = THREAD_TS
    resp2 = post_json("files.completeUploadExternal", complete)
    assert resp2["ok"], f"completeUpload failed: {resp2}"
    print(f"Delivered to Slack channel {channel_id}")

elif SERVICE == "imessage":
    import subprocess
    state_dir = os.environ.get("OPENCLAW_STATE_DIR", "/data/.openclaw")
    subprocess.run(["bash", f"{state_dir}/scripts/imsg-ssh", "send",
        "--to", SENDER_ID, "--file", output_path, "--service", "imessage"], check=True)
    print(f"Delivered to iMessage {SENDER_ID}")
PYEOF
```

### How to fill in the template

1. **Replace the chart data section** with real data (query from local-db first using `sqlite3 -json /data/ranch_data.db "SQL"`)
2. **Set `CHANNEL_ID`** = `channel_id` from Conversation info if available; if only `sender_id` (U...) is available, use that — the script auto-resolves it to the DM channel
3. **Set `THREAD_TS`** = **ALWAYS set this** to the `ts` (or `thread_ts`) of the message that triggered the request — this makes the chart reply in the thread. For DMs, use the `ts` of the user's message. For channel threads, use `thread_ts`. **Never leave this empty.**
4. **Set `SERVICE`** = `"slack"` or `"imessage"`
5. Run as a **single exec call** — wait for success before replying

### After the exec succeeds

Reply with a short caption only. Examples:
- "Here's your cattle count by group!"
- "Chart generated — cattle are distributed across 6 lots."

Do NOT say the file path. Do NOT say you "sent" the file. The chart is already inline.

---

## Chart Type Reference

| Type | Function |
|------|----------|
| Bar | `px.bar()` |
| Horizontal bar | `px.bar(orientation='h')` |
| Line | `px.line()` |
| Scatter | `px.scatter()` |
| Pie | `px.pie()` |
| Heatmap | `px.imshow()` |
| Box | `px.box()` |
| Histogram | `px.histogram()` |

Always use: `template="plotly_dark"`, `color_discrete_sequence=px.colors.qualitative.Vivid`, `text=` on bars/lines to show values.
