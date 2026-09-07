# 各类别人数统计报告

## 1. 数据来源与摘要

- **输入文件**：`counts.txt`（SHA256: `a533500c66faa53e64578d54b169ea3d42ab11cb16a17732ffba20f9fc68d8b6`）
- **单位**：人（people）
- **数据性质**：完全合成数据（synthetic），仅用于演示
- **图表尺寸**：800×600 px，PNG 格式

## 2. 数据表

| 类别 | 人数（人） | 备注         |
|------|-----------|-------------|
| 甲组 | 10        | 有效值       |
| 乙组 | 20        | 有效值       |
| 丙组 | —         | **缺失**，未补零 |

## 3. 缺失值处理口径

- 原始文件中丙组的 `count` 字段为空字符串，pandas 读入后为 `NaN`。
- **缺失 ≠ 零**：丙组数据缺失不代表该组人数为零，因此**不做补零处理**。
- 条形图仅绘制有有效数值的类别（甲组、乙组），丙组不纳入图表。
- 图表底部以注释形式标明"丙组数据缺失，未补零，不纳入图表"。

## 4. 图表说明

- **图型选择依据**：数据为离散类别（甲组/乙组）的人数比较，适合使用条形图。
- **Y 轴从零起始**，符合类别比较条形图规范。
- **中文标签**：使用预装离线字体 `AnalysisSans.ttf`，通过 matplotlib Agg 后端渲染。
- **数值标注**：每个条形上方标注具体人数。
- ⚠️ **视觉检查声明**：当前环境无 GUI/浏览器，无法进行人工视觉校验。已通过程序验证 PNG 文件非空且尺寸为 800×600 px，但**未完成中文缺字、标签裁切、图例遮挡等视觉准确性检查**。如需确认视觉效果，请下载 chart.png 自行查看。

## 5. 运行环境

| 组件        | 版本    |
|------------|---------|
| Python     | 3.11    |
| matplotlib | 3.10.3  |
| pandas     | 2.2.3   |
| numpy      | 2.2.6   |
| 后端        | Agg（离线）|
| 中文字体    | AnalysisSans.ttf |

## 6. 完整可复现 Python 脚本

以下脚本可直接在相同离线环境中运行，生成 `chart.png`：

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
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

font_manager.fontManager.addfont('/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
font = font_manager.FontProperties(fname='/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
plt.rcParams['font.family'] = font.get_name()
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['pdf.fonttype'] = 42

# --- Load data ---
input_path = '/workspace/counts.txt'
df = pd.read_csv(input_path, nrows=3)

# Missing-value policy: empty count -> NaN, NOT zero.
df_plot = df.dropna(subset=['count']).copy()
df_plot['count'] = df_plot['count'].astype(int)

categories = df_plot['category'].tolist()
counts = df_plot['count'].tolist()

all_categories = df['category'].tolist()
missing_categories = [c for c in all_categories if c not in categories]

# --- Create bar chart at exact 800x600 pixels ---
fig = plt.figure(figsize=(8, 6), dpi=100)
ax = fig.add_subplot(111)

colors = ['#4C72B0', '#55A868']
bars = ax.bar(categories, counts, color=colors[:len(categories)], edgecolor='black', linewidth=0.8)

for bar, val in zip(bars, counts):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3,
            str(val), ha='center', va='bottom', fontsize=14, fontproperties=font)

ax.set_xlabel('类别', fontsize=14, fontproperties=font)
ax.set_ylabel('人数（人）', fontsize=14, fontproperties=font)
ax.set_title('各类别人数统计条形图', fontsize=16, fontproperties=font)
ax.set_ylim(0, max(counts) * 1.25)
ax.yaxis.grid(True, linestyle='--', alpha=0.7)
ax.set_axisbelow(True)

for label in ax.get_xticklabels():
    label.set_fontproperties(font)
    label.set_fontsize(13)
for label in ax.get_yticklabels():
    label.set_fontproperties(font)
    label.set_fontsize(12)

if missing_categories:
    note = '注：' + '、'.join(missing_categories) + ' 数据缺失，未补零，不纳入图表。'
    fig.text(0.5, 0.01, note, ha='center', fontsize=11, fontproperties=font, style='italic')

plt.subplots_adjust(left=0.12, right=0.95, top=0.90, bottom=0.12)
output_path = '/workspace/chart.png'
fig.savefig(output_path, dpi=100)
plt.close(fig)

print(f"Chart saved: {output_path}, size={os.path.getsize(output_path)} bytes")
```

## 7. 产出物清单

| 文件        | 说明                          |
|------------|-------------------------------|
| chart.png  | 800×600 中文条形图（甲组10人、乙组20人） |
| report.md  | 本报告，含数据表、缺失口径与可复现脚本   |
