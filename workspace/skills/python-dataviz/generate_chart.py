import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import os

# Data from BigQuery
data = [
    {"birth_year": "2014", "cattle_count": "4"},
    {"birth_year": "2015", "cattle_count": "5"},
    {"birth_year": "2016", "cattle_count": "4"},
    {"birth_year": "2017", "cattle_count": "3"},
    {"birth_year": "2018", "cattle_count": "4"},
    {"birth_year": "2019", "cattle_count": "3"},
    {"birth_year": "2020", "cattle_count": "3"},
    {"birth_year": "2021", "cattle_count": "3"},
    {"birth_year": "2022", "cattle_count": "3"},
    {"birth_year": "2023", "cattle_count": "8"},
    {"birth_year": "2024", "cattle_count": "17"},
    {"birth_year": "2025", "cattle_count": "49"}
]

df = pd.DataFrame(data)
df["birth_year"] = df["birth_year"].astype(int)
df["cattle_count"] = df["cattle_count"].astype(int)

# --- Standard chart theme --- apply to every chart ---
THEME = "plotly_dark"
COLORS = px.colors.qualitative.Vivid

fig = px.bar(
    df,
    x="birth_year",
    y="cattle_count",
    text="cattle_count",
    title="Cattle Count Per Birth Year (Active Animals)",
    template=THEME,
    color_discrete_sequence=COLORS,
    labels={"birth_year": "Birth Year", "cattle_count": "Number of Cattle"}
)
fig.update_traces(texttemplate="%{text}", textposition="outside")
fig.update_layout(
    font=dict(size=14),
    margin=dict(t=60, b=60, l=60, r=30),
    xaxis=dict(tickmode='array', tickvals=df['birth_year']), # Ensure all years are shown
    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
)

media_dir = os.path.join(os.environ.get("OPENCLAW_STATE_DIR", "/data/.openclaw"), "media")
os.makedirs(media_dir, exist_ok=True)
output_path = os.path.join(media_dir, "cattle_count_by_birth_year.png")
fig.write_image(output_path, width=1200, height=700, scale=2)
print(f"CHART_PATH:{output_path}")
