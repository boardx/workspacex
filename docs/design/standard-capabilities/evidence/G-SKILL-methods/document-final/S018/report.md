# 文档理解报告

## 1. cross-page-table.pdf：Revenue 提取与合计

### 1.1 跨页表格候选分组说明
- 解析返回警告 `cross_page_table_grouping_heuristic`，表示两页表格被 AnyDoc/pdfplumber 以“相邻页、同列数、重复非空表头”规则归为同一 `tableId=pdf-table-0`。
- 这是保守候选分组，不是确定语义拼接；本报告将四个 Revenue 值作为同一季度表的连续数据行进行求和，但同时保留每行的真实页码与单元格定位以便追溯。

### 1.2 四个 Revenue 数值及可追溯定位
| # | Revenue 原文 | 页码 | tableId | fragmentIndex | rowIndex | columnIndex | PDF点空间 bbox (x0,y0,x1,y1) | Region 识别状态 |
|---|--------------|------|---------|---------------|----------|-------------|------------------------------|-----------------|
| 1 | 120          | 1    | pdf-table-0 | 0             | 1        | 1           | [210.0, 90.0, 380.0, 130.0] | 无法辨认（原文为 "?") |
| 2 | 230          | 1    | pdf-table-0 | 0             | 2        | 1           | [210.0, 130.0, 380.0, 170.0]| 无法辨认（原文为 "?") |
| 3 | 340          | 2    | pdf-table-0 | 1             | 1        | 1           | [210.0, 90.0, 380.0, 130.0] | 无法辨认（原文为 "?") |
| 4 | 450          | 2    | pdf-table-0 | 1             | 2        | 1           | [210.0, 130.0, 380.0, 170.0]| 无法辨认（原文为 "?") |

- 表头单元格（Region / Revenue）分别位于第1页 fragmentIndex=0 rowIndex=0 和第2页 fragmentIndex=1 rowIndex=0，bbox 均为 [40.0,50.0,210.0,90.0] 与 [210.0,50.0,380.0,90.0]，证实重复表头启发式成立。
- Region 列在两个片段中均只识别出 "?"，按用户要求不猜测地区文字，保留为不可识别。

### 1.3 合计
- 四个 Revenue 数值之和：120 + 230 + 340 + 450 = **1140**
- 单位：原文表格未标注货币或计量单位，此处仅给出纯数值合计，不编造缺失单位。

### 1.4 来源摘要（PDF）
- 附件ID：daf0b6a7-20ae-4ba7-b4ff-3dfc44f8a39a
- 文件路径：/inputs/a02cd02c287c550b85070a1077b3af16ce4d82d67987fdec6168022931c5d83a/cross-page-table.pdf
- SHA256（sourceHash）：454b1bfbf7a7bf93d6f1d29e94e9404d0fa3a91144c3bc6a5e0f57f44b8d547d
- textHash：0af0311aa67439ce70e79864bf7611c83ec2772629d9d064cddda805a2039fab
- structureHash：821d7301a1623a753cc68c6327b7f60d091a2452cd16680edf70152f68f67fd5
- warnings：ocr_not_performed, cross_page_table_grouping_heuristic

---

## 2. scanned-note.png：金额与币种识别

### 2.1 OCR 识别结果
- 扫描页码：Page 1（单页图像，渲染尺寸 1200×400 像素）
- 识别文本："SCANNED NOTE: Amount 75 Currency not stated"
- 金额：**75**
  - 词框：{"x":518,"y":118,"width":40,"height":30}
  - Tesseract 置信度：92.33%
- 币种：**未声明**
  - 原文明确写出 "Currency not stated"，无货币符号或代码可供提取。

### 2.2 识别局限与风险提示
- 警告：`ocr_may_misrecognize_text`, `tables_may_lose_layout`
- 所有词置信度介于 88.77%–93.04%，属中等偏上但非绝对可靠；关键金额 75 建议对照原图人工复核。
- 坐标空间为渲染页像素（非 PDF 点），仅用于图像内相对定位。
- 未检测到结构化表格；若原图存在表格线或对齐，OCR 输出可能丢失布局语义。
- 币种字段明确缺失，不补合理猜测。

### 2.3 来源摘要（PNG）
- 附件ID：994c2254-d527-492d-a7ab-76bb4d396783
- 文件路径：/inputs/0a1ed03988faa151c3d900d7980b1bcdf981e8e51f7170b9229b094006676d9c/scanned-note.png
- SHA256（sourceHash）：93e1801c90c2d43d9cc7e40c5cf7a47a80757c9bc81478047924e17f1968803f
- textHash：9753db3de4c1c05f067a82bc1ab9397a2a4db6a64c2d3a9a68c91786a78e44d3
- structureHash：5b3d08dfe630c20aa1a41c7e1e6a4761d237ec1d240c07852ed8249ed40a2a33
- warnings：ocr_may_misrecognize_text, tables_may_lose_layout

---

## 3. 完整性声明
- 两份原件均未修改，SHA256 与 manifest 一致。
- PDF 跨页合计基于启发式分组，已明确标注候选性质；Region 不可识别部分未猜测。
- PNG 金额来自 OCR，币种原文即缺失，未补全。
- 所有定位信息均来自工具返回的 structure.json，未从 Markdown 行号或顺序推断。
