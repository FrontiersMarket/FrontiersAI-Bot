
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import os
import json

data = [
    {"average_daily_gain":"4.2","breed":"Charolais","ear_tag_id":"9302","name":None},
    {"average_daily_gain":"4.0","breed":"Charolais","ear_tag_id":"9677","name":None},
    {"average_daily_gain":"4.0","breed":"Charolais","ear_tag_id":"E144","name":"MLS STATESMAN E144"},
    {"average_daily_gain":"4.0","breed":"Charolais","ear_tag_id":"E144","name":"MLS STATESMAN E144"},
    {"average_daily_gain":"3.9","breed":"Charolais","ear_tag_id":"E157","name":"MLS ADVANCE E157"},
    {"average_daily_gain":"3.9","breed":"Charolais","ear_tag_id":"E157","name":"MLS ADVANCE E157"},
    {"average_daily_gain":"3.9","breed":"Charolais","ear_tag_id":"1828","name":None},
    {"average_daily_gain":"3.8","breed":"Charolais","ear_tag_id":"207","name":None},
    {"average_daily_gain":"3.6","breed":"Charolais","ear_tag_id":"7629","name":None},
    {"average_daily_gain":"3.5","breed":"Charolais","ear_tag_id":"7140","name":None}
]

# Convert to DataFrame
df = pd.DataFrame(data)
df['average_daily_gain'] = df['average_daily_gain'].astype(float)
df['display_name'] = df['name'].fillna(df['ear_tag_id'])

# Sort by ADG for consistent plotting
df = df.sort_values(by='average_daily_gain', ascending=False)

# Set up the plot
plt.figure(figsize=(12, 7))
sns.barplot(x='display_name', y='average_daily_gain', hue='breed', data=df, palette='viridis')

plt.title('Top 10 Heaviest Cattle by Average Daily Gain and Breed', fontsize=16)
plt.xlabel('Cattle (Name/Ear Tag ID)', fontsize=12)
plt.ylabel('Average Daily Gain', fontsize=12)
plt.xticks(rotation=45, ha='right')
plt.legend(title='Breed', bbox_to_anchor=(1.05, 1), loc='upper left')
plt.tight_layout()

# Save the plot
media_dir = os.path.join(os.environ.get("OPENCLAW_STATE_DIR", os.path.expanduser("~/.openclaw")), "media")
os.makedirs(media_dir, exist_ok=True)
output_path = os.path.join(media_dir, "top_10_adg_cattle_chart.png")
plt.savefig(output_path, dpi=300, bbox_inches="tight")

print(f"CHART_PATH:{output_path}")
