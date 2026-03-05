
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import os

data = [
  {"average_weight":"58479.67","breed":"Akaushi"},
  {"average_weight":"2299.1","breed":"American Aberdeen"},
  {"average_weight":"1563.0","breed":"Smokey mix"},
  {"average_weight":"1385.0","breed":"Dutch Belted"},
  {"average_weight":"1308.77","breed":"Limousin"},
  {"average_weight":"1275.5","breed":" Beefmaster/angus"},
  {"average_weight":"1270.0","breed":"Wagyu "},
  {"average_weight":"1260.0","breed":"Black balding "},
  {"average_weight":"1239.0","breed":"Wyagus "},
  {"average_weight":"1235.0","breed":"Holstein Cross"}
]

df = pd.DataFrame(data)
df['average_weight'] = df['average_weight'].astype(float)

# Sort for better visualization in a horizontal bar chart
df = df.sort_values(by='average_weight', ascending=True)

plt.figure(figsize=(10, 7))
sns.barplot(x='average_weight', y='breed', data=df, palette='viridis')
plt.title('Top 10 Cattle Breeds by Average Weight', fontsize=16, fontweight='bold')
plt.xlabel('Average Weight (lbs)', fontsize=12)
plt.ylabel('Breed', fontsize=12)
plt.tight_layout()

media_dir = os.path.join(os.environ.get("OPENCLAW_STATE_DIR", os.path.expanduser("~/.openclaw")), "media")
os.makedirs(media_dir, exist_ok=True)
output_path = os.path.join(media_dir, "top_10_breed_weight_chart.png")
plt.savefig(output_path, dpi=150, bbox_inches="tight")
print(f"Chart saved to: {output_path}")
