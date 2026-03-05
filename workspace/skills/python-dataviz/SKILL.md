---
name: python-dataviz
description: Professional data visualization using Python (matplotlib, seaborn, plotly). Create publication-quality static charts, statistical visualizations, and interactive plots. Use when generating charts/graphs/plots from data, creating infographics with data components, or producing scientific/statistical visualizations. Supports PNG/SVG (static) and HTML (interactive) export.
---

# Python Data Visualization

Create professional charts, graphs, and statistical visualizations using Python's leading libraries.

## Libraries & Use Cases

**matplotlib** - Static plots, publication-quality, full control
- Bar, line, scatter, pie, histogram, heatmap
- Multi-panel figures, subplots
- Custom styling, annotations
- Export: PNG, SVG, PDF

**seaborn** - Statistical visualizations, beautiful defaults
- Distribution plots (violin, box, kde, histogram)
- Categorical plots (bar, count, swarm, box)
- Relationship plots (scatter, line, regression)
- Matrix plots (heatmap, clustermap)
- Built on matplotlib, integrates seamlessly

**plotly** - Interactive charts, web-friendly
- Hover tooltips, zoom, pan
- 3D plots, animations
- Dashboards via Dash framework
- Export: HTML, PNG (requires kaleido)

## Chart Quality Standard — Use This Template Always

**Use plotly express for ALL charts.** It produces the best-looking modern charts. Use matplotlib/seaborn only if plotly is explicitly unavailable.

```python
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import os

# --- Standard chart theme --- apply to every chart ---
THEME = "plotly_dark"       # dark, modern look
COLORS = px.colors.qualitative.Vivid   # vivid distinct colors

# Example: bar chart
fig = px.bar(
    df,
    x="label_col",
    y="value_col",
    color="category_col",   # optional grouping
    text="value_col",       # show values on bars
    title="Your Chart Title",
    template=THEME,
    color_discrete_sequence=COLORS,
)
fig.update_traces(texttemplate="%{text:.1f}", textposition="outside")
fig.update_layout(
    font=dict(size=14),
    margin=dict(t=60, b=60, l=60, r=30),
    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
)

# Save as high-res PNG
media_dir = os.path.join(os.environ.get("OPENCLAW_STATE_DIR", "/data/.openclaw"), "media")
os.makedirs(media_dir, exist_ok=True)
output_path = os.path.join(media_dir, "chart.png")
fig.write_image(output_path, width=1200, height=700, scale=2)  # scale=2 → retina quality
print(f"CHART_PATH:{output_path}")
```

**Chart type → plotly function:**
| Type | Function |
|------|----------|
| Bar | `px.bar()` |
| Horizontal bar | `px.bar(orientation='h')` |
| Line | `px.line()` |
| Scatter | `px.scatter()` |
| Pie | `px.pie()` |
| Heatmap | `px.imshow()` or `go.Heatmap` |
| Box/violin | `px.box()` / `px.violin()` |
| Histogram | `px.histogram()` |

Always include: `text=` on bars/lines (show values), meaningful `title=`, axis labels via `labels={"col":"Human Label"}`.

---

## Delivering Charts to Users — NON-NEGOTIABLE RULES

**NEVER output a file path or URL. ALWAYS send the image as an inline attachment — on every channel.**

### Step 0 — Send acknowledgement BEFORE starting
Chart generation takes 5–15 seconds. Send a brief heads-up first.

**iMessage:**
```bash
/data/.openclaw/scripts/imsg-ssh send --to "<sender_id>" --text "Generating your chart, just a moment..." --service imessage
```
**Slack:** Post a short text reply before starting work (e.g. "Generating your chart, just a moment...").

### Step 1 — Generate chart
Use the plotly template above. Save to the media dir.

### Step 2 — Send the image inline (ALL channels)

Use the unified send script — handles iMessage and Slack automatically:

```bash
bash /data/workspace/scripts/send-attachment.sh \
  --to "<sender_id_or_channel_id>" \
  --file "<output_path>" \
  --service "<imessage|slack>" \
  --text "Here's your chart!"
```

- `sender_id` / `channel_id` from `Conversation info` metadata: `{ "sender_id": "...", "channel_id": "...", "service": "imessage|slack" }`
- **iMessage**: `--to` = phone/handle, `--service imessage`
- **Slack**: `--to` = Slack channel ID (e.g. `C1234567890`), `--service slack` — image uploads directly and renders inline in the channel

### Step 3 — Your text reply
After running the send script, reply with a short caption only.

❌ Wrong: `"Here is the chart: /data/.openclaw/media/chart.png"`
❌ Wrong: `"Here's your chart: https://storage.googleapis.com/..."`
✅ Right: `"Here's your chart!"` (image already delivered inline)

---

## Quick Start

### Setup Environment

```bash
cd skills/python-dataviz
python3 -m venv .venv
source .venv/bin/activate
pip install .
```

### Create a Chart

```python
import matplotlib.pyplot as plt
import numpy as np

# Data
x = np.linspace(0, 10, 100)
y = np.sin(x)

# Plot
plt.figure(figsize=(10, 6))
plt.plot(x, y, linewidth=2, color='#667eea')
plt.title('Sine Wave', fontsize=16, fontweight='bold')
plt.xlabel('X Axis')
plt.ylabel('Y Axis')
plt.grid(alpha=0.3)
plt.tight_layout()

# Export
plt.savefig('output.png', dpi=300, bbox_inches='tight')
plt.savefig('output.svg', bbox_inches='tight')
```

## Chart Selection Guide

**Distribution/Statistical:**
- Histogram → `plt.hist()` or `sns.histplot()`
- Box plot → `sns.boxplot()`
- Violin plot → `sns.violinplot()`
- KDE → `sns.kdeplot()`

**Comparison:**
- Bar chart → `plt.bar()` or `sns.barplot()`
- Grouped bar → `sns.barplot(hue=...)`
- Horizontal bar → `plt.barh()` or `sns.barplot(orient='h')`

**Relationship:**
- Scatter → `plt.scatter()` or `sns.scatterplot()`
- Line → `plt.plot()` or `sns.lineplot()`
- Regression → `sns.regplot()` or `sns.lmplot()`

**Heatmaps:**
- Correlation matrix → `sns.heatmap(df.corr())`
- 2D data → `plt.imshow()` or `sns.heatmap()`

**Interactive:**
- Any plotly chart → `plotly.express` or `plotly.graph_objects`
- See references/plotly-examples.md

## Best Practices

### 1. Figure Size & DPI
```python
plt.figure(figsize=(10, 6))  # Width x Height in inches
plt.savefig('output.png', dpi=300)  # Publication: 300 dpi, Web: 72-150 dpi
```

### 2. Color Palettes
```python
# Seaborn palettes (works with matplotlib too)
import seaborn as sns
sns.set_palette("husl")  # Colorful
sns.set_palette("muted")  # Soft
sns.set_palette("deep")  # Bold

# Custom colors
colors = ['#667eea', '#764ba2', '#f6ad55', '#4299e1']
```

### 3. Styling
```python
# Use seaborn styles even for matplotlib
import seaborn as sns
sns.set_theme()  # Better defaults
sns.set_style("whitegrid")  # Options: whitegrid, darkgrid, white, dark, ticks

# Or matplotlib styles
plt.style.use('ggplot')  # Options: ggplot, seaborn, bmh, fivethirtyeight
```

### 4. Multiple Subplots
```python
fig, axes = plt.subplots(2, 2, figsize=(12, 10))
axes[0, 0].plot(x, y1)
axes[0, 1].plot(x, y2)
# etc.
plt.tight_layout()  # Prevent label overlap
```

### 5. Export Formats
```python
# PNG for sharing/embedding (raster)
plt.savefig('chart.png', dpi=300, bbox_inches='tight', transparent=False)

# SVG for editing/scaling (vector)
plt.savefig('chart.svg', bbox_inches='tight')

# For plotly (interactive)
import plotly.express as px
fig = px.scatter(df, x='col1', y='col2')
fig.write_html('chart.html')
```

## Advanced Topics

See references/ for detailed guides:

- **Color theory & palettes**: references/colors.md
- **Statistical plots**: references/statistical.md
- **Plotly interactive charts**: references/plotly-examples.md
- **Multi-panel layouts**: references/layouts.md

## Example Scripts

See scripts/ for ready-to-use examples:

- `scripts/bar_chart.py` - Bar and grouped bar charts
- `scripts/line_chart.py` - Line plots with multiple series
- `scripts/scatter_plot.py` - Scatter plots with regression
- `scripts/heatmap.py` - Correlation heatmaps
- `scripts/distribution.py` - Histograms, KDE, violin plots
- `scripts/interactive.py` - Plotly interactive charts

## Common Patterns

### Data from CSV
```python
import pandas as pd
df = pd.read_csv('data.csv')

# Plot with pandas (uses matplotlib)
df.plot(x='date', y='value', kind='line', figsize=(10, 6))
plt.savefig('output.png', dpi=300)

# Or with seaborn for better styling
sns.lineplot(data=df, x='date', y='value')
plt.savefig('output.png', dpi=300)
```

### Dictionary Data
```python
data = {'Category A': 25, 'Category B': 40, 'Category C': 15}

# Matplotlib
plt.bar(data.keys(), data.values())
plt.savefig('output.png', dpi=300)

# Seaborn (convert to DataFrame)
import pandas as pd
df = pd.DataFrame(list(data.items()), columns=['Category', 'Value'])
sns.barplot(data=df, x='Category', y='Value')
plt.savefig('output.png', dpi=300)
```

### NumPy Arrays
```python
import numpy as np

x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.plot(x, y)
plt.savefig('output.png', dpi=300)
```

## Troubleshooting

**"No module named matplotlib"**
```bash
cd skills/python-dataviz
source .venv/bin/activate
pip install -r requirements.txt
```

**Blank output / "Figure is empty"**
- Check that `plt.savefig()` comes AFTER plotting commands
- Use `plt.show()` for interactive viewing during development

**Labels cut off**
```python
plt.tight_layout()  # Add before plt.savefig()
# Or
plt.savefig('output.png', bbox_inches='tight')
```

**Low resolution output**
```python
plt.savefig('output.png', dpi=300)  # Not 72 or 100
```

## Environment

The skill includes a venv with all dependencies. Always activate before use:

```bash
cd "$OPENCLAW_WORKSPACE_DIR/skills/python-dataviz"
source .venv/bin/activate
```

If the venv does not exist yet, initialize it first:

```bash
cd "$OPENCLAW_WORKSPACE_DIR/skills/python-dataviz"
python3 -m venv .venv
source .venv/bin/activate
pip install matplotlib seaborn plotly pandas numpy kaleido
```

Dependencies: matplotlib, seaborn, plotly, pandas, numpy, kaleido (for plotly static export)
