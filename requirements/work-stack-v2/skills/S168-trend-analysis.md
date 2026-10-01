# S168 — Trend Analysis（趋势分析）

> Type: Work Skill · Domain: Data & Research（D002 研究 / D058 不动产 / D059 能源消费）· Strategy: A1（两个上游 Skill 择优改写 + 公开时间序列方法学）· 目标通道：candidate → verified（ADR-119 G5）
> 本文独立作者化（AUTHOR-S168），基线 `main@30c1c4332025151610502988b0379b95ff7298c7`。v1 模板（`origin/requirements/work-stack-320-v1:requirements/work-stack-v1/skills/S168-*.md`）只当话题清单，未沿用正文。

## 1. 这个 Skill 解决什么问题
回答一个问题：**「这条时间序列（或这组带日期的信号）在去掉日历、季节和口径变化之后，是否存在一个真实、持续的方向性变化？从什么时候开始、多大、有多确定、最多能说到什么程度？」**

S168 产出 `TrendReport`：每条序列的日历对齐记录、口径断点、季节性处理方式、趋势方向与斜率区间、变点、持续性分类（`emerging` / `sustained` / `reversing` / `no-trend` / `indeterminate`）以及允许的措辞上限。

边界（与已 PASS 或同图 Skill 的分工）：
- **不预测**。外推未来值属于预测类能力（销售侧是 S031；能源价格/负荷预测在 D059 的 skillGaps 中，见 §13）。S168 只描述"已观测区间"的趋势，输出里没有未来时点的数值（决策 1）。
- **不做开放式探索**。挑哪条指标、哪个切片是 S157 Data Exploration 的职责；S168 接收已指定的序列。
- **不做一般性假设检验**。组间比较、实验显著性属 S161 Statistical Analysis；S168 只做单序列/成组序列的时间方向检验。
- **不评证据等级**。`signal-series` 模式下信号来源的可信度由 S171 Evidence Review 判；S168 只数"随时间的量"。
- **不出图**。可视化交给 S164 Data Visualization；S168 输出给 S164 的是结构化的趋势段与变点标注。

## 2. 图上的消费者（逐条对照两张矩阵，原样列出）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
**无。** 矩阵中没有任何 Workflow 行列出 S168（已逐行 grep `S168`：仅出现在 DIGITALHUMAN-COMPOSITION-MATRIX.md）。因此 S168 当前只在聊天中由下列 DigitalHuman 直接调用；按 ADR-118 决策 9，不存在"Workflow 固定 S168 版本"的场景。是否应进入 W057 / W001 见 §13（仅提议）。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
| DigitalHuman | 矩阵行 | 该行原文 Workflows / Skills | S168 在该角色中的典型问题 | `domainProfile` 缺省 |
|---|---|---|---|---|
| D002 Research & Knowledge Analyst | 第 8 行 | W001, W060, W009, W006, W057 / S003, S063, S171, S169, S172, S170, S016, S020, **S168**, S167 | "过去 8 个季度，客户在工单与访谈中提到『数据合规』的频率是否在上升？" | `general`（常用 `signal-series` 模式） |
| D058 Real Estate Analyst | 第 64 行 | W001, W037, W057, W009 / S167, **S168**, S088, S089, S081, S010, S164, S098 | "该城市甲级写字楼空置率与租金过去 5 年是否出现拐点？" | `real-estate` |
| D059 Energy Analyst | 第 65 行 | W001, W057, W059, W042 / **S168**, S167, S157, S161, S164, S108, S010 | "某省现货日前电价在去掉季节和节假日后是否存在上行趋势？" | `energy` |

三个角色的差异只落在 `domainProfile`（§5、§4 步骤 2/3 的日历与季节规则），不复制 Skill（决策 5）。

## 3. 上游来源与许可（G1）
| 上游 | 精确路径 | commit SHA | 工件级许可 | 采用方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `data/skills/statistical-analysis/SKILL.md` 中「Trend Analysis and Forecasting」一节（Moving averages / Period-over-period / Growth rates / Seasonality Detection / 「Always communicate uncertainty」） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`data/LICENSE`） | adapt：借鉴"同比优先于环比以避免把季节当趋势""给区间不给点值"的原则，映射到步骤 4 的比较基准选择与决策 3；不复制正文与代码，按 Apache-2.0 §4 在 `references/upstream.md` 记 NOTICE |
| K-Dense-AI/claude-scientific-skills | `skills/statsmodels/SKILL.md`（frontmatter `license: BSD-3-Clause license`，指 statsmodels 库）+ `skills/statsmodels/references/time_series.md`（ADF/KPSS 平稳性检验、`seasonal_decompose` 与 STL 分解示例） | `49c6e97775eaa18ba791bebe23162a70ae601c18` | Skill 文本：仓根 `LICENSE` 为 MIT（Copyright (c) 2025 K-Dense Inc.）；frontmatter 的 BSD-3-Clause 描述被引用库 statsmodels 的许可 | adapt（仅方法结构）：借鉴"先判平稳性、再分解、STL 比经典分解更稳健"的顺序；因沙箱当前无 statsmodels（§7），实现时不能直接沿用其代码路径。记 MIT 声明 |

公开方法学（仅引用名称与定义，不复制文本）：Mann-Kendall 单调趋势检验、Theil–Sen 斜率估计、CUSUM / 二分分割变点检测、STL（Cleveland et al., 1990）。

未采用：`claude-scientific-skills/skills/timesfm-forecasting`、`aeon`——均为预测/建模工具，与决策 1（不外推）冲突，reference-only 都不需要。

## 4. 专业方法（S168 专属步骤）
1. **序列契约核对**。对每条输入序列确认：度量（`measure`）、单位、聚合方式（sum / mean / last / rate）、观测频率（D/W/M/Q/Y）、时区。`rate` 类（空置率、价差）禁止跨期求和；`last` 类（期末库存、在租面积）禁止对日内求均值。任一项缺失 → `SERIES_CONTRACT_INCOMPLETE`，不猜。
2. **日历对齐**（按 `domainProfile` + `jurisdiction`）。
   - CN：春节/中秋等农历节日在公历上漂移，月度同比须标记"春节所在月"错位（1 月 vs 2 月）；法定调休导致"周末上班日"——日频工作量/负荷序列按**实际工作日**而非周一至周五对齐。
   - US：Thanksgiving/Black Friday 周漂移、夏令时切换日的 23/25 小时（小时频能源序列必须按 UTC 聚合后再转本地）、零售 4-4-5 财务日历与自然月不等长。
   - 输出每条序列的 `calendarAdjustments[]`，每项写明规则与受影响的期数。
3. **口径断点识别**。以下情形视为 `definition-break`，断点前后不得拟合同一条趋势：统计口径变更（如新房/二手房合并口径、城市行政区划调整）、电力市场规则切换（如某省从中长期为主切入现货连续结算试运行）、内部指标重定义（`knowledge.read` 读指标口径文档可辅助发现）。断点来源必须带证据（调用方提供的 `knownBreaks` 或口径文档引用）；只有统计上的跳变而无口径证据时，记为 `structural-break-candidate`（步骤 6），不当口径断点。
4. **比较基准与季节处理**。按频率与长度决定：
   - 有 ≥2 个完整季节周期：做季节分解（首选 STL；沙箱无 statsmodels 时降级为居中移动平均的经典分解，`seasonalMethod` 如实记录），趋势检验在去季节分量上做。
   - 只有 1 个周期：只报同比（YoY/同期），不做分解，`persistence` 上限为 `emerging`。
   - 无季节性证据（季节分量方差占比 < `seasonalVarianceFloor`，缺省 0.1）：直接在原序列上检验。
5. **趋势检验与幅度估计**。在步骤 4 的目标分量上做 Mann-Kendall（非参数，不假设线性、容忍离群），幅度用 Theil–Sen 斜率及 95% 区间（按对斜率排序取秩区间，纯 numpy 可实现）。序列自相关（lag-1 ACF > 0.3）时，p 值改用块自助法（block bootstrap，块长 = 季节周期或 √n 取较大），并标 `autocorrelationAdjusted: true`。报告斜率时同时给**相对幅度**（斜率 × 观测跨度 / 起点水平），避免"每月 +0.02"这种看不出大小的数字。
6. **变点检测**。在去季节分量上跑 CUSUM + 二分分割，最小段长 = max(2 个季节周期, 6 个观测)。每个候选变点与 `knownBreaks`、`eventMarkers` 对照：能对上外部事件的标 `explained-by`；对不上的保留为 `unexplained`，不编造原因（决策 4）。
7. **持续性分类**（S168 的核心判定）：
   - `sustained`：MK 显著（α=0.05，经自相关校正）且最近一段（最后一个变点之后）斜率区间不跨 0、段长 ≥ 2 个季节周期。
   - `emerging`：最近一段方向显著但段长不足 2 个周期，或只有同比证据。
   - `reversing`：最近一个变点前后斜率符号相反且两段区间均不跨 0。
   - `no-trend`：MK 不显著且 Theil–Sen 区间跨 0 且序列长度满足最小长度。
   - `indeterminate`：长度不足（< `minObservations`，按频率：M≥24、Q≥12、W≥104、D≥730）、缺失率 > 20%、或跨口径断点后的最近段过短。
8. **成组序列一致性**（多条序列时）。同一问题下多个地区/资产/渠道：报各自分类的分布，并做"方向一致性"检查——若加总序列显示上升而多数成员下降，标 `composition-driven`（辛普森式结构效应），不把加总趋势当普遍趋势。
9. **`signal-series` 模式专属**：输入是带日期的证据条目（来自 S003 账本或知识库），先按 `periodGrain` 计数，再**按同期总量归一**（提及率 = 命中条目 / 同期全部条目），因为知识库本身在增长，原始计数几乎总是"上升"。分母缺失 → 只报原始计数并将 `persistence` 上限压到 `indeterminate`（决策 2）。
10. **措辞上限**。由 `persistence` 映射 `allowedAssertion`：`sustained`→`state`；`emerging`/`reversing`→`likely`；`no-trend`→`state-no-trend`；`indeterminate`→`omit`。

## 5. 输入契约（`inputSchema`，写入 WorkSkillManifest）
```ts
TrendAnalysisInput = {
  mode: "metric-series" | "signal-series";
  question: string;                                     // ≤500 字，用于报告标题与范围声明
  series?: Array<{                                      // metric-series 必填，1..50 条
    seriesId: string;                                   // 调用方内唯一
    label: string;
    source: { kind: "file" | "snapshot"; fileId?: string; snapshotId?: string; column: string; timeColumn: string };
    measure: { unit: string; aggregation: "sum" | "mean" | "last" | "rate"; frequency: "D" | "W" | "M" | "Q" | "Y"; timezone: string }; // IANA 时区
    groupKey?: string;                                  // 成组序列的分组标签（地区/资产）
  }>;
  signals?: {                                           // signal-series 必填
    items: Array<{ itemId: string; sourceId: string; occurredAt: string; matched: boolean }>; // ≤20000 条
    denominatorPerPeriod?: Array<{ period: string; total: number }>;
    periodGrain: "W" | "M" | "Q";
  };
  knownBreaks?: Array<{ seriesId?: string; at: string; kind: "definition-change" | "market-rule-change" | "boundary-change"; evidenceRef: string }>;
  eventMarkers?: Array<{ at: string; label: string; evidenceRef?: string }>;
  domainProfile?: "general" | "real-estate" | "energy";  // 缺省取 DigitalHuman 映射（§2.2），再缺省 general
  jurisdiction?: "CN" | "US" | "other";
  window?: { from: string; to: string };                // 缺省为数据全区间
  alpha?: number;                                       // 缺省 0.05，允许 0.01..0.1
}
```
不变式（服务端 zod 校验）：
- I1 `mode="metric-series"` ⇔ `series` 非空且 `signals` 缺省；`signal-series` 反之。
- I2 `seriesId` 唯一；同一 `groupKey` 下 `measure.unit` 与 `frequency` 必须一致。
- I3 `window.from < window.to`；`knownBreaks[].at` 落在 `window` 内，否则忽略并记 warning。
- I4 `aggregation="rate"` 的序列不得作为成组加总的成员（步骤 8 只比较方向，不加总）。

## 6. 输出契约（`outputSchema`，S168 专属）
```ts
TrendReport = {
  question: string; mode: "metric-series" | "signal-series";
  domainProfile: "general" | "real-estate" | "energy"; profileSource: "input" | "digital-human-default" | "fallback";
  series: Array<{
    seriesId: string;
    observations: { count: number; missingRate: number; from: string; to: string };
    calendarAdjustments: Array<{ rule: string; affectedPeriods: number }>;
    definitionBreaks: Array<{ at: string; kind: string; evidenceRef: string }>;
    seasonalMethod: "stl" | "classical-ma" | "yoy-only" | "none";
    seasonalVarianceShare?: number;                    // 0..1
    trendTest: {
      method: "mann-kendall";
      statisticS: number; pValue: number; autocorrelationAdjusted: boolean;
      pValueMethod: "normal-approx" | "block-bootstrap";
    } | { notRun: "insufficient-length" | "too-many-missing" | "capability-denied" };
    slope?: { perPeriod: number; ci95: [number, number]; relativeOverSpan: number; unit: string };
    changePoints: Array<{ at: string; direction: "up" | "down" | "level-shift"; attribution: { kind: "explained-by"; ref: string } | { kind: "unexplained" } }>;
    recentSegment?: { from: string; slopeCi95: [number, number]; periods: number };
    persistence: "sustained" | "emerging" | "reversing" | "no-trend" | "indeterminate";
    allowedAssertion: "state" | "likely" | "state-no-trend" | "omit";
    reasons: string[];                                 // 每个降级都要一条，≥1
  }>;
  group?: { groupKey: string; distribution: Record<Persistence, number>; aggregateDirection: "up" | "down" | "flat"; compositionDriven: boolean };
  signalNormalization?: { normalized: boolean; denominatorSource: "input" | "missing" };
  handoffToVisualization: Array<{ seriesId: string; segments: Array<{ from: string; to: string }>; annotations: Array<{ at: string; text: string }> }>; // 供 S164
  warnings: string[];
}
```
输出不变式：
- O1 **不含任何晚于 `observations.to` 的时点数值**（决策 1；schema 层以 refinement 检查 `handoffToVisualization` 与 `changePoints` 的日期）。
- O2 `persistence="sustained"` ⇒ `trendTest` 已运行、`pValue < alpha`、`recentSegment.slopeCi95` 不跨 0、`recentSegment.periods ≥ 2 × 季节周期`。
- O3 `definitionBreaks` 非空 ⇒ `slope` 只基于最后一个断点之后的数据（`reasons` 必须写明）。
- O4 `mode="signal-series"` 且 `denominatorSource="missing"` ⇒ 所有 `persistence="indeterminate"`。
- O5 故意不含 `forecast`、`recommendation`、`cause` 字段；`unexplained` 变点不得附带原因文字。

### 6.1 类型化错误
| code | 条件 | 行为 |
|---|---|---|
| `SERIES_CONTRACT_INCOMPLETE` | 步骤 1 任一 measure 字段缺失或与数据不符（如声明 M 但时间戳为日频且未聚合） | 整体拒绝，列出缺失字段 |
| `COLUMN_NOT_FOUND` | `column`/`timeColumn` 不存在 | 列出最接近的 3 个列名 |
| `SOURCE_ACCESS_DENIED` | 服务端核实调用 principal 无 `fileId`/`snapshotId` 读权限 | 不泄露文件是否存在 |
| `MIXED_FREQUENCY_GROUP` | 违反 I2 | 拒绝该组，其余序列照常 |
| `SANDBOX_RESOURCE_EXHAUSTED` | 超时 / 内存 | 不输出半份报告；可缩短 `window` 重试一次 |
| `CAPABILITY_UNAVAILABLE` | 所需能力分类未授权 | 对应序列 `trendTest.notRun="capability-denied"`，不换工具 |

## 7. 依赖与运行时（逐项核实）
已核实存在（基线 `30c1c43` 读过）：
- 沙箱执行 `apps/skill-sandbox/src/execute-script.ts`（`timeoutMs` 选项、`MAX_ARTIFACT_BYTES = 32 MiB`）；输入文件 `apps/skill-sandbox/src/input-files.ts`（`MAX_INPUT_FILE_BYTES = 32 MiB`、`MAX_INPUT_FILES = 256`）。
- 依赖锁 `apps/skill-sandbox/analysis/requirements.lock`：含 `numpy==2.2.6`、`pandas==2.2.3`，**不含 scipy、statsmodels**（逐行查过）。
- 分析运行时约定 `skills/data-workflows/references/runtime.md`（存在；内容由 S161 文档引用，本文未逐条复核 → 细节 UNVERIFIED）。

据此：Mann-Kendall（S 统计量 + 含并列校正的方差 + `math.erf` 正态近似）、Theil–Sen、CUSUM/二分分割、居中移动平均经典分解、块自助法全部可用纯 numpy/pandas 实现；**STL 需要 statsmodels → 当前 `seasonalMethod` 只能是 `classical-ma`**，STL 路径为 proposed-unwired（与 S161 §8 同一依赖提议，不另提一份）。

能力分类（ADR-120；分类字段本身 proposed-unwired）：
- required：`file.read`、`sandbox.exec`。
- optional：`knowledge.read`（读指标口径文档辅助步骤 3；`signal-series` 读 S003 账本条目）、`warehouse.read`（proposed-unwired，`skills/data-workflows/README.md` 标明数仓路径不可用——该判断沿用已 PASS 的 S157 文档，本文未独立复读 → UNVERIFIED）。
- 全部只读，riskClass = low，S168 不声明写能力。

## 8. 授权边界（调用方声明 vs 服务端核实）
- **调用方声明、仅作提示**：`domainProfile`、`jurisdiction`、`knownBreaks`、`eventMarkers`、`measure.*`、`denominatorPerPeriod`、DigitalHuman 身份。`knownBreaks` 只能**切断**趋势段（使结论更保守），不能被用来删除数据点。
- **服务端必须核实**：①调用 principal 对每个 `fileId`/`snapshotId` 的读权限（具体授权函数 UNVERIFIED，实现时须接入现有 files 域访问检查，Skill 内不自判）；②`signal-series` 中每个 `sourceId` 对调用者可见——不可见条目从分子**和分母**同时剔除并计数进 `warnings`，避免通过提及率反推不可见文档的存在；③`domainProfile` 缺省值来自服务端 DigitalHuman 注册表而非请求体；④`alpha` 范围钳制在 0.01..0.1。
- `measure.aggregation` 与实际数据不符时以数据为准报错（`SERIES_CONTRACT_INCOMPLETE`），而不是按声明硬算。

## 9. 决策
- **决策 1：S168 只描述已观测区间，不输出任何未来值。** D059 的矩阵行把"Energy price forecast; Load forecast"列为 skillGaps——说明预测能力被明确认定为缺失。若 S168 顺手外推（线性延长趋势线），就等于用一个低质量预测静默填补缺口，这正是矩阵说明所禁止的"用相近 Skill 近似"。O1 把这一点变成 schema 约束。
- **决策 2：`signal-series` 必须按同期总量归一，否则压到 `indeterminate`。** D002 的典型问题是"某话题是否越来越常被提到"，而组织知识库文档量本身逐季增长；原始计数下几乎所有话题都会呈"上升"。强制分母是本 Skill 最主要的反误报设计。
- **决策 3：持续性用离散五档而不是趋势强度分数。** 下游（S063 综述、S020 简报、W037 投资备忘中的 D058 手工引用）需要的是"能不能说'持续上升'"，一个 0–100 分无法回答。五档各有可机械核对的前提（O2），且直接映射措辞上限，与 S171 的 `allowedAssertion` 思路一致但取值集不同（趋势语义 vs 证据语义），不共用枚举。
- **决策 4：变点只做"已知事件对照"，不做原因归因。** 变点对上 `eventMarkers` 就标 `explained-by`，对不上就 `unexplained`。让模型为变点编原因（"可能由于政策调整"）是趋势报告最常见的幻觉来源；归因属于 S011 Root Cause Analysis 或人的判断。
- **决策 5：领域差异放 `domainProfile`，不拆 D058/D059 专用 Skill。** 不动产（季度频、样本短、口径多变）与能源（小时/日频、强季节、市场规则切换）差异在日历规则、最小长度与断点类型，方法主干一致；拆分会让三份文档维护同一套 MK/Theil–Sen/变点逻辑（同一事实两处声明）。
- **决策 6：口径断点只接受有证据的来源；统计跳变只作候选。** 若允许模型把任何跳变认定为"口径变更"并切段，就能把任何不想要的趋势切没。`definitionBreaks` 必须带 `evidenceRef`。

## 10. CN / US 差异（实质性的部分）
- **日历**：CN 春节漂移（1/2 月同比失真，须合并 1–2 月或标错位）、法定调休工作日；US Thanksgiving 周漂移、DST 小时频 23/25 小时、4-4-5 财务月。
- **能源（D059）**：CN 电力现货市场按省推进，各省连续结算试运行起点不同，现货价序列的起点与规则切换点必须作为 `market-rule-change` 断点；US 各 ISO/RTO（如 ERCOT、PJM）节点价格长期可得，但稀缺定价规则调整同样构成断点。具体省份/ISO 的切换日期本文不列举，须由调用方以 `knownBreaks` 带证据提供（本文不对其现状作断言）。
- **不动产（D058）**：CN 统计口径常以季度/月度城市级指数发布，且城市/区划口径调整较多，最小长度要求使许多城市只能到 `emerging`；US 市场数据多为季度 submarket 级，样本相对长但来源多为商业数据商（许可须由调用方确认，S168 不下载外部数据）。
- 两地共同点：S168 不接入任何外部数据源，只处理调用方已授权提供的文件/快照。

## 11. 失败模式（S168 特有）
| # | 失败 | 具体表现 | 防线 |
|---|---|---|---|
| F1 | 季节当趋势 | 用 3–8 月数据报"空调负荷持续上升" | 步骤 4 + `minObservations` |
| F2 | 春节错位 | 2 月同比 −35% 被报为"反转" | 步骤 2 CN 规则 |
| F3 | 跨口径拟合 | 统计口径合并前后连成一条线报"跳升" | 步骤 3 + O3 |
| F4 | 分母增长伪趋势 | 知识库提及数上升实为文档总量上升 | 决策 2 + O4 |
| F5 | 结构效应 | 加总空置率上升但 7/10 子市场下降 | 步骤 8 `compositionDriven` |
| F6 | 自相关下假显著 | 日频电价 lag-1 ACF 0.8 仍用正态近似 p | 步骤 5 块自助法 |
| F7 | 偷偷外推 | 报告写"预计明年达到 X" | 决策 1 + O1 |
| F8 | 变点编原因 | "4 月拐点源于新政" 无证据 | 决策 4 + O5 |
| F9 | 断点滥用 | 以"口径调整"为名切掉不利区段 | 决策 6 |
| F10 | 通过提及率探测不可见文档 | 分母含不可见条目 | §8 ② |

## 12. 评测（`evals/work-stack/S168/`，ADR-119；夹具为合成数据）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | 48 个月合成负荷序列：强年度季节 + 零趋势 + 噪声 | `persistence="no-trend"`，`seasonalMethod="classical-ma"`，slope 区间跨 0 |
| E2 | 同 E1 但叠加每月 +0.5% 线性趋势 | `sustained`，`allowedAssertion="state"`，`relativeOverSpan` 在真值 ±30% 内 |
| E3 | 仅 3–8 月 6 个观测、上升 | `indeterminate`（长度不足），无 `trendTest` 结果 |
| E4 | CN 月度零售序列 2023–2025，春节在 1 月/2 月交替 | `calendarAdjustments` 含春节规则；不因 2 月同比 −30% 判 `reversing` |
| E5 | 季度城市空置率 16 季，第 9 季带 `knownBreaks`（口径合并，evidenceRef 给出） | `definitionBreaks` 长度 1；`slope` 仅用第 9 季之后数据；`reasons` 提及断点 |
| E6 | 同 E5 但第 9 季跳变无 `knownBreaks` | 跳变出现在 `changePoints`（`unexplained`），`definitionBreaks` 为空 |
| E7 | `signal-series`：命中数 10→40 线性增，分母 100→400 同比例增 | `normalized=true`，`no-trend`；若去掉分母 → 全部 `indeterminate` |
| E8 | 10 个子市场：7 个缓降、3 个大体量急升，加总上升 | `group.compositionDriven=true`，`distribution` 如实 |
| E9 | 730 日 AR(1) φ=0.85 随机游走式电价，无真实趋势 | `autocorrelationAdjusted=true`，`pValueMethod="block-bootstrap"`，不得 `sustained` |
| E10 | 前 30 月上升、后 18 月下降（变点在第 30 月，`eventMarkers` 给出规则切换） | `reversing`；变点 `attribution.kind="explained-by"` |
| E11 | 输出 schema：任意夹具 | zod 通过；无晚于 `observations.to` 的日期；无 `forecast`/`cause` 字段 |
| E12 | 授权：`signal-series` 中 20% 条目属调用者不可见的 source | 分子分母同时剔除；`warnings` 记数；输出不含这些 `itemId` |
| E13 | US 小时频负荷含 DST 切换日 | 按 UTC 聚合，`calendarAdjustments` 含 DST 规则；切换日不产生变点 |

## 13. WorkspaceX 落位
- Skill 包：新建 `skills/data-workflows/trend-analysis/SKILL.md`（与现有 `skills/data-workflows/data-analysis/` 同包，复用沙箱与 runtime 约定），含 `references/calendars.md`（CN/US 日历规则单一事实源）、`references/profiles.md`（`general`/`real-estate`/`energy` 最小长度与断点类型）、`references/upstream.md`（Apache-2.0 NOTICE + MIT 声明）、`scripts/trend.py`（纯 numpy/pandas）、`evals/`。元数据按 ADR-117 写 frontmatter `metadata.work`（proposed-unwired）。
- 已核实存在：`apps/skill-sandbox/src/execute-script.ts`、`apps/skill-sandbox/src/input-files.ts`、`apps/skill-sandbox/analysis/requirements.lock`、`skills/data-workflows/data-analysis/SKILL.md`。
- proposed-unwired：`WorkSkillManifest`、能力分类字段、`evals/work-stack/S168/` 与 G5 门、DigitalHuman → `domainProfile` 缺省映射的服务端注册表、STL（依赖 statsmodels 入锁）。

## 14. Graph change proposals（只提议，不改矩阵）
1. **W057 Question-to-Analysis**（S157, S160, S158, S161, S164, S172）的拥有者含 D002/D058/D059，三者都挂 S168，但 W057 不含 S168。时间方向问题（"是否在上升"）在 W057 里目前只能落到 S161，而 S161 不做季节分解与变点。建议评估在 W057 的 S161 之前/并列加入 S168，由 W057 作者决定。
2. **W060 Research-to-Evidence** 对 D002 的"话题热度随时间"问题，`signal-series` 模式可位于 S003 检索之后、S169 综合之前；仅作提议。
3. D059 skillGaps "Energy price forecast; Load forecast" 应作为新 Skill 创建，**不**以 S168 扩展替代（决策 1）。
4. 不建议与 S161 合并：两者输出语义（时间方向 vs 组间差异）与失败模式（季节/口径 vs SRM/多重比较）不同。

## 15. 未决问题
- STL 何时可用取决于 statsmodels 是否入沙箱锁（与 S161 同一提议），此前 `classical-ma` 对首尾各半个周期无趋势估计，E2 的幅度容差按此设定。
- `energy` profile 的小时频序列（8760 点/年）在块自助法 1000 次重采样下的沙箱耗时未测，`timeoutMs` 取值待实现时基准测试确定。
- DigitalHuman → `domainProfile` 的缺省映射放在哪个服务端注册表，需与 D002/D058/D059 作者对齐。
