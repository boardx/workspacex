# 各类别人数条形图报告

## 1. 数据摘要与缺失口径

| 类别 | 人数 (people) | 状态 |
|------|:------------:|------|
| 甲组 | 10 | 有效 |
| 乙组 | 20 | 有效 |
| 丙组 | — | **缺失（未补零）** |

- **数据来源**：`counts.txt`（SHA256: `a533500c66faa53e64578d54b169ea3d42ab11cb16a17732ffba20f9fc68d8b6`）
- **单位**：people
- **缺失处理**：丙组 `count` 字段为空，按原始口径保留为缺失值（NaN），**不补零**。图中仅展示有效数据的类别，丙组不出现在条形图中。
- **数据性质**：完全合成数据（synthetic），仅供演示。

## 2. 图表说明

- **图型**：中文静态条形图（bar chart），用于类别间人数比较。
- **尺寸**：800 × 600 px（PNG）。
- **Y 轴**：从 0 起始，整数刻度，上限为最大值的 125%。
- **柱顶标注**：显示具体人数。
- **底部注释**：明确标注丙组缺失且未补零。
- **字体**：AnalysisSans（预装离线中文字体）。
- **视觉检查声明**：当前环境无 GUI/浏览器，无法进行人工视觉核验。已通过程序验证文件大小（29135 bytes）及像素尺寸（800×600），但**中文渲染、标签裁切、颜色可辨性等视觉质量未经人工确认**。

## 3. 完整可复现 Python 脚本

以下为实际执行生成 `chart.png` 的完整脚本（同 `chart.py`）：

```python
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

# Resize to exact 800x600 if needed
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
```

## 4. 运行环境

| 项目 | 值 |
|------|-----|
| Python | 3.x (sandbox) |
| matplotlib | 3.10.3 |
| pandas | 2.2.3 |
| numpy | 2.2.6 |
| Pillow | 已安装（用于尺寸校验） |
| 后端 | Agg（离线，无 GUI） |
| 字体 | AnalysisSans (`/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf`) |

## 5. 产物清单

| 文件 | 格式 | 说明 |
|------|------|------|
| `chart.png` | image/png | 800×600 中文条形图 |
| `chart.py` | text/plain | 实际运行的完整 Python 脚本 |
| `report.md` | text/markdown | 本报告（含数据表、缺失口径、可复现脚本） |
