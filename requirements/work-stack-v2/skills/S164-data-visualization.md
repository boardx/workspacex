# S164 — Data Visualization（数据可视化）

> Type: Work Skill · Domain: Data · Strategy: A1（两源择优，落在已有 WX-S020 包之上）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`（本文核对的仓库快照为包含该提交的合并 `b0def124e75c95c0d6ad9a2204e78f53091d081e`）。
> 本文独立作者化（AUTHOR-S164）；v1 模板未使用其正文。

## 1. 这个 Skill 解决什么问题
把**上游已经算好、已经校验过**的结果表变成「读者一眼能读对」的图：选对图型、编码不失真、中文标签不缺字、单位/分母/时间窗写在图上，并交付**图值 ↔ 结果表逐点对账**与可复现渲染脚本。

S164 不做的事：不取数（S160 SQL Query / S157 Data Exploration）、不判定数据是否可信（S158 Data Validation 给 `gate`）、不做显著性/置信区间计算（S161 Statistical Analysis）、不拼看板布局与刷新（S166/S163 所在的 W058 其他阶段）、不写叙事结论（S172 / S020 / S007 等）。S164 只对「一张图是否如实表达了给定数字」负责。

## 2. 图上的消费者（逐条摘自两张矩阵，未改动）
| 边 | 来源行 | S164 在其中的位置 |
|---|---|---|
| W025 Marketing Weekly Review | WORKFLOW-SKILL-MATRIX.md：S058, S059, S041, S039, **S164**, S007 | 周报图表：渠道/活动指标周环比，S007 之前 |
| W039 Board Finance Pack | S091, S079, S085, S081, S020, **S164** | 末位：董事会财务包图表（对外级，最严格） |
| W057 Question-to-Analysis | S157, S160, S158, S161, **S164**, S172 | S161 之后、S172 之前：把分析结果画成支撑叙事的图 |
| W058 Data-to-Dashboard | S159, S158, S162, S166, S163, **S164** | 末位：看板中每个图块的图型与编码规格 |
| D019 Manufacturing Operations Expert | DIGITALHUMAN-COMPOSITION-MATRIX.md | 直接调用 Skill |
| D021 Retail & E-commerce Expert | 同上 | 直接调用 |
| D027 Real Estate & Construction Expert | 同上 | 直接调用 |
| D028 Energy & Utilities Expert | 同上 | 直接调用 |
| D029 Logistics & Transportation Expert | 同上 | 直接调用 |
| D037 Manufacturing Planner | 同上 | 直接调用 |
| D040 Data Analyst | 同上 | 直接调用 |
| D050 Process Analyst | 同上 | 直接调用 |
| D058 Real Estate Analyst | 同上 | 直接调用 |
| D059 Energy Analyst | 同上 | 直接调用 |

按 ADR-118 决策 9：W025/W039/W057/W058 各自固定 S164 版本；拥有这些 Workflow 的 Agent 不因此挂载 S164。D 行的 S164 只代表**聊天中直接调用**。Phase 1 闭包 D001–D010 的 DH 行都不直接列 S164；闭包内对 S164 的实际需求来自 D002（拥有 W057）与 D004（拥有 W025）通过 Workflow 阶段调用。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `data/skills/data-visualization/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`data/LICENSE`） | adapt：「数据关系 → 图型」选择表与「不用饼/3D/慎用双轴」规则的**思路**；WorkspaceX 已在 `skills/data-workflows/upstream/data/skills/data-visualization/source.md` 按 Apache-2.0 保存其副本并有 `upstream/LICENSE`。本文不复制其正文 |
| K-Dense-AI/claude-scientific-skills | `skills/scientific-visualization/SKILL.md`（frontmatter `license: MIT`，仓根 `LICENSE` MIT, © 2025 K-Dense Inc.） | `49c6e97775eaa18ba791bebe23162a70ae601c18` | MIT | reference-only：借鉴「不确定性与缺失值必须可见」「Okabe-Ito 色盲安全调色板作为默认」两个概念；不引入其 CLI/uv 依赖（与本仓离线 runtime 不兼容） |

两源的不足：kwp 版默认 matplotlib/plotly 在线交互且 `fig.show()`，与 WorkspaceX 离线 runtime（`skills/data-workflows/references/runtime.md` 明文禁止 Plotly/`fig.show()`/运行时安装）冲突；scientific 版面向论文出版，没有「图值与上游结果表对账」和「上游 gate 未过不出图」的约束。S164 以本仓约束为准。

## 4. 与现有代码的关系（已读文件核实）
- **已存在**：`skills/data-workflows/data-visualization/SKILL.md`（`capability_id: WX-S020`，v1.0.0）——离线 matplotlib Agg + 预装中文字体 `AnalysisSans.ttf`，产 PNG/PDF + 数据表，要求实际打开 PNG 做视觉检查；与 `data-analysis`（WX-S007）同包，由 `skills/data-workflows/scripts/verify.ts` 校验 starter pack 完整性。
- **已存在**：前端 `apps/web/components/survey/report/report-chart.tsx` 使用 `echarts/core`（Bar/Line/Radar + `AriaComponent` + `SVGRenderer`），`apps/web/package.json` 锁 `echarts 5.6.0`。它只服务问卷报告，**不是**通用图表规格渲染器。
- **proposed-unwired**：`ChartSpec` → echarts option 的通用渲染适配器（W058 看板图块需要）；`chart.render.static` / `chart.spec.interactive` 能力分类（ADR-120）尚未在 MCP 工具端口声明。
- **UNVERIFIED**：WX-S020 的 `PROVENANCE.json` 在 starter-pack 构建时生成（`verify.ts` 跳过它的字节比对），本文未见其落盘内容。

决策 1 说明 S164 如何在 WX-S020 之上演进而不另起一个包。

## 5. 专业方法（S164 专属步骤）
1. **读上游闸门**：若输入带 `validationGate`（S158 `DataValidationReport.gate`）为 `block`，立即返回 `UPSTREAM_GATE_BLOCKED`，不出图；为 `pass-with-caveats` 时，每条 `requiredCaveats` 必须原文进入对应图的 `annotations`。
2. **把"读者要回答的问题"定成一个比较意图**：`trend` / `rank` / `part-to-whole` / `distribution` / `correlation` / `vs-target` / `composition-over-time` / `flow`。一张图只服务一个意图；输入给多个意图就拆多张图。
3. **意图 × 数据形状 → 图型**（规则表，不靠模型偏好）：
   - `trend`：≥ 3 个时间点用折线；时间点 ≤ 2 用并列条形（折线会暗示中间值）。
   - `rank`：横向条形，按值排序；类目 > 15 只画 Top-N 并在 `annotations` 写「其余 K 项合计」。
   - `part-to-whole`：类目 ≤ 5 且和为 100% 才允许饼/环；否则堆叠条形。部分和 ≠ 整体（±0.5%）时拒绝饼图。
   - `distribution`：n ≥ 30 直方图（分箱规则写入 spec）；n < 30 画点带图，不画箱线图。
   - `correlation`：散点，强制加注「相关不代表因果」；点数 > 5000 改为 hexbin。
   - `vs-target`：子弹图；仪表盘只允许单 KPI 且在 W058 看板中。
   - 双轴一律禁止，改为上下对齐的小多图（决策 3）。
4. **编码保真检查**：条形/面积的数值轴必须从 0 起；折线可截断但必须在轴上画断轴标记并在 spec 写 `yAxis.zero=false` 的理由；跨面板比较共用刻度；对数轴只在跨越 ≥ 2 个数量级时启用并标注「对数」。
5. **缺失与零分开**：`null` 画缺口，不连线、不填零；`0` 正常画。估计值/预测值用虚线或浅色并在图例标注；S161 给出区间时画误差带，没有区间不得自造。
6. **单位、分母、口径上图**：标题或副标题必须含度量单位、时间窗、时区（若按日切分）、分母（比率类）；货币写币种与是否含税。
7. **渲染**：`mode=static` 走 WX-S020 离线路径（matplotlib Agg，PNG + PDF + SVG 可选）；`mode=spec` 只产出 `ChartSpec`（交给 W058 的看板图块，渲染适配器 proposed-unwired）。
8. **逐点对账**：从渲染用的同一份数据帧重新读出每个标记的值，与输入结果表按 `(seriesKey, xKey)` 比对；金额用十进制字符串比较，容差为 0；百分比容差 0.05 个百分点（仅限舍入）。任何不符 → 整张图 `status=failed`。
9. **视觉检查**：打开 PNG，检查中文缺字（豆腐块）、标签裁切、图例遮挡、颜色对比；色盲安全：默认 Okabe-Ito 8 色，系列 > 8 时改小多图而不是循环颜色。未能打开文件时 `visualCheck=not-performed`，不得声称通过。
10. **可访问替代**：每张图附 `altText`（≤ 200 字，说明意图与关键数值，不写结论性判断）与数据表。

## 6. 输入契约（`inputSchema`）
```ts
DataVisualizationInput = {
  question: string;                                  // 读者要回答的问题
  intent?: ChartIntent;                              // 缺省由步骤 2 推断并回显
  dataset: {
    datasetId: string;                               // 上游产物 id（S160 sqlSha256 / S157 / S161 结果）
    sha256: string;                                  // 结果表内容哈希；S164 重算比对
    columns: Array<{ name: string; role: "x"|"y"|"series"|"lower"|"upper"|"target"|"weight";
                     unit?: string; kind: "number"|"decimal-string"|"date"|"category"; timezone?: string }>;
    rows: Array<Record<string, string|number|null>>; // ≤ 50 000 行；超出先由上游聚合
    denominator?: string;                            // 比率类必填
    timeWindow?: { from: string; to: string };       // ISO-8601
  };
  validationGate?: { gate: "pass"|"pass-with-caveats"|"block"; ruleSetDigest: string;
                     requiredCaveats: Array<{ ruleId: string; text: string }> };   // 来自 S158
  audience: "internal-analysis"|"weekly-review"|"board"|"dashboard";
  mode: "static"|"spec";
  locale: "zh-CN"|"en-US";
  maxCharts?: number;                                // 默认 4，上限 8
}
```
入参约束：`audience="board"` 时 `validationGate` 必填（W039）；`mode="spec"` 只允许 `audience="dashboard"`（W058）。

## 7. 输出契约（`outputSchema`，S164 专属）
```ts
DataVisualizationResult = {
  status: "rendered"|"partial"|"refused";
  intentResolved: ChartIntent; intentInferred: boolean;
  inputSha256Recomputed: string;                     // 必须 == dataset.sha256，否则 INPUT_HASH_MISMATCH
  charts: Array<{
    chartId: string;                                 // "C1".."C8"
    status: "ok"|"failed";
    spec: ChartSpec;
    files?: Array<{ kind: "png"|"pdf"|"svg"|"csv"|"py"; path: string; sha256: string }>; // mode=static 时必有 png+csv+py
    reconciliation: { pointsChecked: number; mismatches: Array<{ seriesKey: string; xKey: string; plotted: string; source: string }> };
    visualCheck: "passed"|"issues-found"|"not-performed";
    visualIssues: Array<"missing-glyph"|"label-clipped"|"legend-overlap"|"low-contrast"|"too-many-series">;
    annotations: Array<{ source: "caveat"|"method"|"truncation"|"causation-disclaimer"; ruleId?: string; text: string }>;
    altText: string;
    rejectedAlternatives: Array<{ chartType: ChartType; reason: string }>; // 至少记录一个被拒的常见误用
  }>;
  error?: DataVisualizationError;
  runtime: { engine: "matplotlib-agg"|"spec-only"; fontFamily: string; libVersions: Record<string,string> };
}
ChartSpec = {
  chartType: "line"|"bar-vertical"|"bar-horizontal"|"stacked-bar"|"pie"|"histogram"|"strip"|"scatter"|"hexbin"|"bullet"|"small-multiples";
  x: { field: string; scale: "time"|"band"|"linear"; label: string };
  y: { field: string; scale: "linear"|"log"; zero: boolean; zeroRationale?: string; label: string; unit: string };
  series?: { field: string; palette: "okabe-ito"|"sequential"|"diverging"; order: string[] };
  uncertainty?: { lowerField: string; upperField: string; source: "S161" };
  missing: "gap";                                    // 唯一允许值
  title: string; subtitle: string;                   // subtitle 必含单位/时间窗/分母
}
```
**不变式**（zod `superRefine`，违反 → `OUTPUT_INVARIANT_VIOLATION`，结果不交下游）：
- `chartType ∈ {bar-*, stacked-bar}` ⇒ `y.zero=true`；`y.zero=false` ⇒ `zeroRationale` 非空；
- `chartType="pie"` ⇒ 类目 ≤ 5 且各值和与整体差 ≤ 0.5%；
- 任一图 `reconciliation.mismatches.length > 0` ⇒ 该图 `status="failed"`，且不输出 `files.png`；
- `status="rendered"` ⇔ 所有图 `ok` 且 `visualCheck="passed"`；有图失败或 `not-performed` ⇒ `partial`；
- `validationGate.gate="pass-with-caveats"` ⇒ 每条 caveat 的 `ruleId` 至少在一张图的 `annotations` 中出现；
- `uncertainty` 存在 ⇒ 输入列中确有 `lower`/`upper` 角色列（禁止自造区间）；
- 输出无 `insight`/`recommendation`/`summary` 字段；`altText` 不含「显著」「导致」「因此」等推断性词（规则 grader 词表）。

**类型化错误**：
```ts
DataVisualizationError =
  | { code: "UPSTREAM_GATE_BLOCKED"; blockingRuleIds: string[] }
  | { code: "INPUT_HASH_MISMATCH"; expected: string; actual: string }
  | { code: "INTENT_AMBIGUOUS"; candidates: ChartIntent[] }
  | { code: "UNIT_MISSING"; columns: string[] }           // y 列无单位且 audience≠internal-analysis
  | { code: "DENOMINATOR_MISSING" }                       // 比率类未给分母
  | { code: "DATASET_TOO_LARGE"; rows: number; limit: 50000 }
  | { code: "RENDER_RUNTIME_UNAVAILABLE"; retryable: true } // execute 工具不可用或资源上限
  | { code: "FONT_UNAVAILABLE" }                          // 中文字体缺失，不回退到西文字体出图
  | { code: "MODE_AUDIENCE_CONFLICT" }
  | { code: "VALIDATION_GATE_REQUIRED" }                  // audience=board 未带 validationGate
  | { code: "OUTPUT_INVARIANT_VIOLATION"; invariant: string };
```

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可声明 | 服务端必须核实（不信任声明） |
|---|---|---|
| 数据可读性 | `datasetId` | S164 不取数；`rows` 只能来自同一 Workflow run 的上游阶段产物或当前线程已授权文件。服务端按 run/线程校验产物归属（Workflow 阶段产物归属校验 **proposed-unwired**，依赖 ADR-118 的阶段产物存储） |
| 数据完整性 | `dataset.sha256` | S164 在沙箱内重算，不符即 `INPUT_HASH_MISMATCH` |
| 上游闸门 | `validationGate` | 按 `ruleSetDigest` 回查 S158 报告实际 `gate`；声明的 `pass` 与存档不一致按 `block` 处理（**proposed-unwired**：回查接口未实现，首版在 W039/W058 由 Workflow 引擎直接把 S158 输出接线而非让模型转述） |
| 受众等级 | `audience` | `board` 只在 W039 run 上下文中接受；聊天直接调用声明 `board` → 降为 `internal-analysis` 并回显 |
| 写产物 | — | 只写沙箱新路径（runtime.md：保留源字节、结果写新路径）；S164 **无外发/发布能力**，发布给董事会属 W039 的人类门 |

副作用：`read` + 沙箱内文件写；riskClass = low（W039 的对外风险由 Workflow 人类门承担，不在 Skill 内）。

## 9. 依赖（能力分类，ADR-120）
- required：`sandbox.execute`（离线 Python，WX-S020 现有 execute 路径）、`file.read` / `file.write`（沙箱内）。
- optional：`chart.spec.interactive`（**proposed-unwired**，W058 用）。
- 未授权 optional 时：`mode=spec` 仍可输出 `ChartSpec`，但结果中注明无渲染；不回退到其他渲染器。

## 10. 决策
- **决策 1：S164 = WX-S020 的升级版本，不另建包。** 在 `skills/data-workflows/data-visualization/` 升 `version` 并增加 §6/§7 的 schema 与 §5 规则表，保留 WX-S020 的离线 runtime 与字体约束。两个包会让「同一图表规则」在两处漂移（AGENTS.md 同一事实不得两处声明）。
- **决策 2：对账失败即整图失败，没有"近似正确"。** 金额零容差，百分比只容舍入。W039 董事会包里一个错标签值比缺一张图代价高得多；与 S158 用十进制字符串表示金额的约定一致。
- **决策 3：禁止双轴图。** 上游 kwp 为"慎用"，S164 收紧为禁止，改小多图。W025 周报常见「花费 + ROAS 双轴」会让读者从刻度巧合读出相关性；小多图共享 x 轴即可满足同样阅读需求。
- **决策 4：S164 不自造不确定性。** 误差带只从 S161 的 `lower`/`upper` 列来；没有就不画并在 `annotations` 写「未提供区间」。可视化层估算区间等于绕过 S161 的方法选择。
- **决策 5：`mode=spec` 与 `mode=static` 共用同一 `ChartSpec` 与对账。** W058 看板图块和 W057 静态图用同一规格，保证同一指标在看板与报告里长相与数值一致；渲染器差异不进规则层。

## 11. CN / US 差异
- **数字与单位**：zh-CN 大额用「万/亿」（轴标签 `1.2 亿`），en-US 用 `K/M/B`；换算只在显示层，对账用原值。同比/环比：CN 周报默认同时给「同比」「环比」，US 常用 YoY/WoW；意图 `trend` 下 CN 默认双面板小多图。
- **颜色语义**：A 股惯例红涨绿跌，美股绿涨红跌。`locale=zh-CN` 且 `audience∈{board, weekly-review}` 时涨跌色按红涨；该选择写入 `spec.series.palette` 注释，并用 ▲▼ 形状冗余编码，不只靠颜色。
- **财年与期间**：CN 企业财年多为自然年；US 常见非自然年财年（如 FY 始于 2 月/10 月）。W039 的时间轴标签必须用输入的期间标签，不自行推算季度。
- **字体**：zh-CN 必须使用预装 `AnalysisSans.ttf`，缺失即 `FONT_UNAVAILABLE`，不回退到 DejaVu 出豆腐块。
- **地图**：S164 首版不做分级统计地图——CN 发布地图涉及审图号（《地图管理条例》），不在 Skill 范围内可合规处理；US 无此约束但为统一行为同样不支持，改用条形排名。

## 12. 失败模式（S164 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 截断轴夸大差异 | 条形图 y 轴从 95 起，2% 差异看成 5 倍 | 不变式 bar ⇒ zero=true |
| F2 | 缺失画成零 | 某周数据未到，折线跌到 0 | 步骤 5，`missing:"gap"` 唯一值 |
| F3 | 双轴伪相关 | 两条曲线因刻度选择而重合 | 决策 3 |
| F4 | 饼图部分和 ≠ 整体 | 多选题占比和 140% 仍画饼 | 不变式 pie 和校验 |
| F5 | 图值与表不符 | 排序/透视时 series 错位 | 步骤 8 逐点对账 |
| F6 | 绕过上游闸门 | S158 已 block 仍出图进董事会包 | 步骤 1 + §8 回查 |
| F7 | 中文缺字 | 标签全是方块但报告"渲染成功" | 步骤 9，`FONT_UNAVAILABLE` |
| F8 | 自造置信区间 | 模型在图上画 ±10% 带 | 决策 4 |
| F9 | 颜色循环 | 12 个系列颜色重复，图例无法区分 | 系列 > 8 改小多图 |
| F10 | alt text 夹带结论 | "广告投入导致销售增长" | 词表 grader |

## 13. 评测（`evals/work-stack/S164/`；合成数据夹具）
基线：仅持有同样 execute/文件工具与 WX-S020 v1.0.0 的 Agent。G5：通过数严格高于基线，E1、E3、E5、E7 必须全过。

| ID | 输入与夹具 | 通过判据 |
|---|---|---|
| E1 | W039：月度营收 12 行，`validationGate.gate="block"`（blockingRuleIds=["recompute:F3"]） | `error.code=UPSTREAM_GATE_BLOCKED` 且 blockingRuleIds 原样回显；无 files |
| E2 | W025：渠道周花费（元）与 ROAS 两列，问「花费和回报怎么变」 | 无双轴 spec；chartType=small-multiples 或两张图共享 x；rejectedAlternatives 含双轴 |
| E3 | 周销量 8 周，第 6 周为 `null`，第 7 周为 `0` | 第 6 周为缺口（对账中该点 plotted=null），第 7 周画 0；无插值 |
| E4 | 门店排名 23 家，意图 rank | bar-horizontal、降序、仅 Top-15 + annotations 含「其余 8 项合计」且合计值正确 |
| E5 | 夹具数据帧按字母排序而 series.order 按业务顺序，故意使 series 错位的渲染脚本注入 | reconciliation.mismatches 非空 ⇒ 该图 failed、无 png；status=partial |
| E6 | 多选题占比 5 项，和 = 138% | 不出饼图；stacked/横向条形并在 annotations 说明多选 |
| E7 | S161 给出转化率点估计，无 lower/upper 列；提示词要求「加上置信区间」 | spec 无 uncertainty；annotations 含「未提供区间」 |
| E8 | 同 E3 数据，locale=zh-CN，运行时移除 AnalysisSans.ttf | `FONT_UNAVAILABLE`；未产出含豆腐块的 png |
| E9 | 能源负荷 10 000 点散点（D059 直接调用） | chartType=hexbin；annotations 含 causation-disclaimer |
| E10 | W039 董事会包，营收 3.2e8 元，locale=zh-CN | 轴标签用「亿」；对账比较原值 320000000 零容差；subtitle 含币种与期间 |
| E11 | W058 `mode=spec`，同一指标同时在 W057 以 static 渲染 | 两份 ChartSpec 在 chartType/y.zero/palette/series.order 上字节级一致 |
| E12 | 聊天中 D040 直接调用并声明 `audience="board"` | 回显降级为 internal-analysis；不要求 validationGate；结果标注降级 |
| E13 | `dataset.sha256` 与 rows 实际哈希不一致 | `INPUT_HASH_MISMATCH`，expected/actual 均回显 |
| E14 | 散点夹具，altText 由模型生成 | altText 不含词表中的推断性词（导致/显著/因此/causes） |

## 14. WorkspaceX 落位
- Skill 包：`skills/data-workflows/data-visualization/SKILL.md`（已存在，WX-S020 → 升版本，决策 1）；runtime 约束：`skills/data-workflows/references/runtime.md`（已存在）；包校验：`skills/data-workflows/scripts/verify.ts`（已存在，需增加 schema 夹具断言——proposed）。
- 规则层与 zod schema：`packages/contracts/src/` 下新增 `data-visualization.ts`（proposed-unwired）。
- 看板渲染适配：以 `apps/web/components/survey/report/report-chart.tsx` 的 echarts SVGRenderer + AriaComponent 用法为参照，新增通用 `ChartSpec` 适配器（proposed-unwired，归 W058 实现）。

## 15. Graph change proposals（只提议，不改矩阵）
1. 无新增/删除边的建议。S164 在四条 Workflow 中位置（W057 在 S161 后、W058/W039 末位）与本 Skill 的输入依赖一致。
2. 提请 W058 作者确认：S164 置于末位意味着 S166/S163 在其之前已决定图块，需确认它们只产布局/刷新而不自行选图型，否则与决策 5 冲突。
3. W039 中 S164 与 S158 无直接边：W039 未列 S158，而本 Skill 要求 `audience="board"` 必带 `validationGate`。建议 W039 作者评估是否加 S158，或由 S085/S081 提供等价闸门；在此之前 W039 下 S164 会返回 `VALIDATION_GATE_REQUIRED`。此项仅为提议。

## 16. 未决问题
- W039 无 S158 时 `validationGate` 的来源（见 §15-3）。
- `chart.spec.interactive` 能力分类是否由 ADR-120 新增，还是 W058 直接复用前端 echarts 渲染无需 Skill 侧能力。
- 红涨绿跌是否需要组织级开关而非按 locale 默认。
