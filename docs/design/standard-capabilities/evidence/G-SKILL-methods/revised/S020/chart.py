import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MPLBACKEND'] = 'Agg'
os.environ['MPLCONFIGDIR'] = '/tmp/workspacex-matplotlib'
from pathlib import Path
config_dir = Path(os.environ['MPLCONFIGDIR'])
config_dir.mkdir(exist_ok=True)
fontconfig = config_dir / 'fonts.conf'
fontconfig.write_text('<fontconfig><dir>/usr/share/fonts</dir><cachedir>/tmp/workspacex-font-cache</cachedir></fontconfig>')
os.environ['FONTCONFIG_FILE'] = str(fontconfig)

import pandas as pd
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from matplotlib import font_manager
from PIL import Image

font_manager.fontManager.addfont('/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
font = font_manager.FontProperties(fname='/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
plt.rcParams['font.family'] = font.get_name()
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['pdf.fonttype'] = 42

# === Reproducibility metadata ===
INPUT_PATH = '/inputs/ddec2a93133f64101cabf1c40cd39a26829deb4a82ab0e63844d7fe280ab591d/counts.txt'
INPUT_SHA256 = 'a533500c66faa53e64578d54b169ea3d42ab11cb16a17732ffba20f9fc68d8b6'
OUTPUT_PNG = '/workspace/chart.png'
TARGET_W, TARGET_H = 800, 600
DPI = 100
UNIT = 'people'
MISSING_POLICY = 'keep_missing_no_fill_zero'

# === Read data ===
df = pd.read_csv(INPUT_PATH, dtype={'category': str, 'count': str}, comment='U')
print("Raw dataframe:")
print(df.to_string(index=False))
print(f"Rows: {len(df)}, Columns: {list(df.columns)}")

# Parse count: empty string stays NaN, never fill with zero
df['count_numeric'] = pd.to_numeric(df['count'], errors='coerce')
missing_mask = df['count_numeric'].isna()
valid_mask = ~missing_mask

print(f"\nValid rows: {valid_mask.sum()}, Missing rows: {missing_mask.sum()}")
for _, row in df.iterrows():
    status = 'MISSING' if pd.isna(row['count_numeric']) else f"value={int(row['count_numeric'])}"
    print(f"  {row['category']}: {status}")

# === Bar chart ===
fig, ax = plt.subplots(figsize=(TARGET_W / DPI, TARGET_H / DPI), dpi=DPI)

valid_df = df[valid_mask].reset_index(drop=True)
categories = valid_df['category'].tolist()
values = valid_df['count_numeric'].astype(int).tolist()

x_pos = np.arange(len(categories))
bars = ax.bar(x_pos, values, color='#4C72B0', edgecolor='black', linewidth=0.8)

# Value labels on bars
for bar, val in zip(bars, values):
    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.3,
            str(val), ha='center', va='bottom', fontsize=12, fontproperties=font)

ax.set_ylabel(f'人数 ({UNIT})', fontsize=13, fontproperties=font)
ax.set_xlabel('类别', fontsize=13, fontproperties=font)
ax.set_title('各类别人数条形图（丙组缺失未补零）', fontsize=14, fontproperties=font)
ax.set_ylim(0, max(values) * 1.25 if values else 10)
ax.yaxis.set_major_locator(plt.MaxNLocator(integer=True))

ax.set_xticks(x_pos)
ax.set_xticklabels(categories, fontproperties=font, fontsize=12)
for label in ax.get_yticklabels():
    label.set_fontproperties(font)

# Note about missing group
note = '注：丙组数据缺失，按原始口径保留为空值，未补零，故不出现在图中。'
fig.text(0.5, 0.01, note, ha='center', fontsize=9, fontproperties=font, style='italic')

# Save without bbox_inches='tight' to preserve exact figure size
fig.subplots_adjust(left=0.12, right=0.95, top=0.90, bottom=0.12)
fig.savefig(OUTPUT_PNG, dpi=DPI, facecolor='white')
plt.close(fig)

# Resize to exact 800x600 if needed (nearest-neighbor to avoid interpolation artifacts)
img = Image.open(OUTPUT_PNG)
if img.size != (TARGET_W, TARGET_H):
    print(f"Resizing from {img.size} to {(TARGET_W, TARGET_H)}")
    img = img.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    img.save(OUTPUT_PNG)

# Final verification
final_img = Image.open(OUTPUT_PNG)
assert final_img.size == (TARGET_W, TARGET_H), f"Final size mismatch: {final_img.size}"
size_bytes = Path(OUTPUT_PNG).stat().st_size
print(f"\nChart saved: {OUTPUT_PNG} ({size_bytes} bytes, {final_img.size[0]}x{final_img.size[1]})")
print(f"Libraries: matplotlib={matplotlib.__version__}, pandas={pd.__version__}, numpy={np.__version__}")
print("Done.")
