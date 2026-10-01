# S071 — Experiment Design（实验设计）

> Type: Work Skill · Domain: Product（同时被 Learning / UX Research 角色在对话中直接调用）· Strategy: A1（两源择优合并）· 目标通道：candidate → verified（ADR-119 G5）
> 本文独立作者化（AUTHOR-S071）。基线：`main@30c1c4332025151610502988b0379b95ff7298c7`。v1 模板只用作话题清单，没有沿用正文。

## 1. 这个 Skill 解决什么问题
S071 在**看到任何结果数据之前**，把一个产品/教学/体验改动的假设写成一份**冻结的实验设计 `ExperimentDesignSpec`**。设计冻结后求两个摘要：`designDigest`（整份 spec，作版本锚点）与 `hypothesesDigest`（只覆盖交给 S161 的 `hypotheses[]`，与 S161 `specDigest` 同算法，作 W031 的预注册凭据）。设计内容包括：

- 该不该做实验（有时结论是「不做实验，直接发布」，或者「做定性测试」）；
- 随机化单元、分析单元、分配比例；
- 主指标、护栏指标、预先写好的 `HypothesisSpec`（与 S161 §5 `hypotheses[]` 元素逐字段同形）；
- 样本量、MDE、实验时长、停止规则；
- 事先写好的决策规则（ship / iterate / kill）。

S071 **不做**的事：
- 算实验结果、做 SRM 检验（S161）；
- 探索数据、检查分组平衡（S157 `experiment-precheck`）；
- 审定指标口径（S072 Metrics Review）；
- 找激活卡点、提出改动假设（S074 产出 `hypotheses[]`，S071 只接收）；
- 实际配置分流开关或功能开关（WorkspaceX 在基线上没有实验分流平台，见 §12）。

实验链路上**最贵的错误都发生在设计阶段**，分析阶段补不回来：单元选错（伪重复）、样本量不够、中途偷看结果就停、事后才换主指标。S071 就是这一步的门。

## 2. 图上的消费者（逐条从矩阵读出，原样照抄）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行 | 矩阵 Skill 集合 | S071 在其中的职责 |
|---|---|---|---|
| W031 Experiment Loop（Product） | 第 37 行 | `S071, S072, S157, S161, S074` | `mode="online-ab"`（或 `cluster`）：产出冻结的 `ExperimentDesignSpec`、`designDigest` 与 `hypothesesDigest`。下游 S157 读取 `precheckContract`，S161 读取 `analysisContract` |

S071 在 WORKFLOW-SKILL-MATRIX.md 中只有这一个 Workflow 消费者。矩阵只给出集合，不给出阶段顺序。本文**假设** S071 位于 S157/S161 之前：S157 决策 3 与 S161 决策 6 都要求结果指标先盲化、spec 先冻结，这个顺序与它们一致。最终顺序由 W031 的作者定。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，S071 均在 Skill 列）
| DigitalHuman | 矩阵行 | 该行 Workflow | 缺省 `domainProfile` |
|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | `product` |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | `ux` |
| D026 Education & Learning Designer | 第 32 行 | W028, W008, W006, W059 | `learning` |
| D043 UX Researcher | 第 49 行 | W027, W028, W031, W060 | `ux` |
| D047 Learning Experience Designer | 第 53 行 | W028, W008, W006, W031 | `learning` |

按 ADR-118 决策 9，Skill 列表示**在对话中直接调用**。W031 在阶段内使用它固定（pin）的 S071 版本，拥有 W031 的角色（D003 / D011 / D043 / D047）不需要为此另外挂载。D026 不拥有 W031，只能在对话中调用 S071，产出的设计没有 W031 运行记录作为预注册锚点（§7）。角色之间的差异只体现在 `domainProfile` 缺省值上，不复制 Skill。

## 3. 上游来源与许可（G1）
| 仓库 | 工件 | Commit | 许可 | 用法 |
|---|---|---|---|---|
| K-Dense-AI/claude-scientific-skills | `skills/experimental-design/SKILL.md`（frontmatter `license: MIT license`，`metadata.version: "1.2"`）及 `references/randomization_and_blocking.md`、`references/design_types.md`、`references/sequential_and_adaptive.md` | `49c6e97775eaa18ba791bebe23162a70ae601c18` | MIT（仓库根目录 `LICENSE.md`，Copyright (c) 2025 K-Dense Inc.；工件 frontmatter 与之一致） | **结构借用**：「先定单元与真重复层级 → 列出干扰因素 → 选设计 → 定重复数 → 带种子生成方案 → 记录/预注册 → 分析与设计匹配」这个顺序；伪重复、整群随机这两类结构性错误。`scripts/randomization.py`、`doe_designs.py` 依赖 pyDOE3，**不引入**（§12） |
| K-Dense-AI/claude-scientific-skills | `skills/statistical-power/SKILL.md`（`license: MIT license`，`version: "1.1"`）及 `references/closed_form_recipes.md` | 同上 | MIT（同上） | 两比例 / 两均值闭式样本量公式、设计效应 `1+(m−1)ICC` 的思路。脚本依赖 statsmodels / scipy，不引入 |
| refoundai/lenny-skills | `skills/product-experiments/SKILL.md` 与 `references/artifacts.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | 仓库根目录 `LICENSE` 为 MIT（Copyright (c) 2025 Refound AI）；**工件 frontmatter 没有 license 字段**，而且正文大段引用播客嘉宾原话，这些引语的版权不属于该仓库 | **仅参考（reference-only）**：只借用话题清单（「何时不该做实验」、护栏 / OEC、SRM 是首要有效性检查、Twyman 定律、「受影响人群占比」对总效应的稀释、长期 holdout）。不复制任何引语或段落 |

需要合并两个来源的原因：K-Dense 面向实验室研究，没有「流量 / 天」换时长、按周取整、护栏指标、「不做实验」这类分支；lenny 版只到原则层面，没有可计算的公式，也没有单元 / 伪重复的结构。S071 的合并点是 **K-Dense 的单元—设计—重复结构 + 闭式样本量**，加上 **lenny 话题清单中的业务闸门（值不值得做实验、稀释、护栏、holdout）**，两者都由本文重新表述。

## 4. 专业方法（S071 专属步骤）
1. **值不值得做实验（`worthRunning` 闸门）。** 输入 `changeRisk`（`reversible-low` / `reversible-high` / `irreversible`）、`isEstablishedPractice`、`eligibleUnitsPerDay`、`maxDurationDays`。规则按顺序判断：
   - 改动不可逆，或会影响价格 / 资费 / 合同条款 → 必须 `run-experiment` 或 `human-decision`，不允许 `ship-without-test`；
   - `reversible-low` 且是公认做法 → `ship-without-test`，附带发布后监控的护栏清单；
   - 按第 5 步能达到的 MDE 大于 `practicalThreshold` 的 2 倍 → `underpowered-alternative`，改为建议定性测试（交 S062）或更粗粒度的 holdout。

   这一步的结论写入 `worthRunning.verdict`，后续步骤只在 `run-experiment` 时继续。
2. **单元三元组。** 明确写出 `randomizationUnit`（user / account / session / classroom / school / geo / time-slice）、`analysisUnit`、`exposureTrigger`（在哪个事件点首次暴露）。`analysisUnit` 比 `randomizationUnit` 更细（例如按班级随机、按学生分析）时，必须声明 `clusterAdjustment`，否则报 `PseudoReplication`。
3. **干扰与溢出（SUTVA）评估。** 按 `interferenceRisk` 的问答（是否共享库存 / 价格、是否有社交或协作关系、教师是否同时教两组）选择设计：`individual`；`cluster`（account / 班级 / 学校）；`switchback`（时间片轮换，适用于双边市场或调度）；`geo`。选择 `switchback` 时要声明 `carryoverWashoutMinutes`。
4. **指标与假设冻结。**
   - 主指标**恰好 1 个**，护栏指标 1–5 个。每个指标用 `metricRef` 引用 S072 审定的口径（W031 内）或调用方声明的口径（对话内，标 `metricSource="caller-declared"`）。
   - 每条假设按 S161 §5 `hypotheses[]` 的字段逐一落成（`hypothesisId`、`origin="preregistered"`、`estimand`、`metric{column,unit,...}`、`groupColumn`、`groups`、`analysisUnit`、`randomizationUnit`、`direction`、`alpha`、`practicalThreshold`、`family`），不增删字段。`direction` 只取 S161 的三个值，由下面的**确定性映射**得出（脚本执行，模型不选）：

     | 假设类别 | 输入 | S161 `direction` | S161 `practicalThreshold` | `family` |
     |---|---|---|---|---|
     | 主指标 | `primarySided` 缺省 `"two-sided"` | `two-sided` | 该指标 `practicalThreshold` | `primary` |
     | 主指标 | `primarySided="one-sided"`，`direction="increase"` / `"decrease"` | `greater` / `less` | 同上 | `primary` |
     | 护栏（不劣于） | `MetricInput.direction="increase"`（越大越好）/ `"decrease"` | `greater` / `less`（单侧，朝「好」的方向） | 该护栏的 `nonInferiorityMargin` | `guardrail` |
     | 次要指标 | 任意 | `two-sided` | 该指标 `practicalThreshold` | `secondary` |

     「不劣于」不引入 S161 没有的字段：非劣效界值 δ 写进 S161 已有的 `practicalThreshold`；判定复用 S161 的 `practicalReading`：区间整体在反方向 δ 之外 = `harmful`（劣于），其余三类视为护栏 `ok`（S161 §4 第 8 步定义）。所以决策表里护栏只有 `ok / harmful` 两态。护栏的单侧检验水准为 `alpha/2`（与主指标双侧同一名义水平）。
   - 次要指标全部放进 `family="secondary"`，并声明 `multiplicity`（`holm` / `bh`）。
5. **样本量与 MDE（确定性计算，模型不得改数）。** 由 `design-calc.mjs`（proposed-unwired，§12）计算：
   - 比例：`n/arm = (z₁₋α/₂ + z₁₋β)² · (p₁q₁ + p₂q₂) / Δ²`；
   - 均值：`2σ²(z₁₋α/₂+z₁₋β)²/Δ²`；
   - 整群设计乘以 `DE = 1 + (m̄−1)·ICC`；
   - 非均等分配乘以 `(1+k)²/(4k)`；
   - 稀释：只有 `triggerRate` 比例的单元会真正碰到改动。输入 `units.analysisPopulation` 缺省 `"triggered"`；调用方显式给 `"all-assigned"` 时，有效 Δ 按 `Δ·triggerRate` 计算，照算并在 `rewrites[]` 中建议 `triggered`（不强行改写调用方选择）。`triggered` 分析要求有暴露日志。
6. **时长。** `durationDays = ceil(totalN / (eligibleUnitsPerDay · trafficFraction))`，然后**向上取整到整周**，并且不少于 `minDurationDays`（缺省 14）。结果大于 `maxDurationDays` 时，反算在该时长内能达到的 `achievableMde`，并给出 `infeasible`，不偷偷放宽 α 或 power。
7. **停止规则。** 只允许两种：
   - `fixed-horizon`：到期才解盲；
   - `group-sequential`：预先声明看数次数 `looks`（2–5 次）和 O'Brien-Fleming 型 α 消耗，边界由脚本算出并写入。

   用户要求「每天看、显著就停」时，改写成 `group-sequential` 并在 `rewrites[]` 中说明；不允许无约束偷看。护栏指标可以设 `harmStop`（单侧、提前停止只能因为有害，不能因为有益）。
8. **随机化方案。** 给出 `assignment.method`（`hash-bucket`：`hash(salt, unitId) mod 10000`；`stratified-permuted-block`：小样本 / 教学场景），以及 `salt`、`strata`、`seed`。S071 只写方案，不执行分流。
9. **事先写好的决策规则表。** 用主指标区间和护栏状态组合出 `ship` / `iterate` / `kill` / `escalate`，词汇与 S161 的 `practicalReading` 四分类对齐（例如 `meaningful` 且护栏没有 `harmful` → `ship`；护栏 `harmful` → `escalate`，不管主指标结果如何）。结果「好得不像真的」（相对提升大于 `twymanThreshold`，缺省 3 倍 `practicalThreshold`）时，强制先复核埋点 / 复现，再允许 `ship`。
10. **冻结与摘要。** 规范化规则 `canon()`：UTF-8、对象键按码点升序、无空白、数组保序、数字用 JS `JSON.stringify` 的最短表示。求两个摘要：
    - `designDigest = sha256(canon(整份 spec 去掉 designDigest 与 hypothesesDigest 两字段))`；
    - `hypothesesDigest = sha256(canon(analysisContract.hypotheses))`，与 S161 §4 第 2 步对自身 `hypotheses` 求 `specDigest` 的输入**是同一个数组**；`analysisContract.experimentDesign.preregistrationDigest = hypothesesDigest`。
    S161 在 W031 中原样接收 `analysisContract.hypotheses` 时，`specDigest === preregistrationDigest`，不需要取回 spec；只要改动任一假设字段（换主指标、改 α、改阈值），两者即不等 → `PreregistrationMismatch`。S161 PASS 文只写了「sha256，规范化 JSON」，未写死 `canon()` 细则，逐字对齐需 S161 确认（§13 提议 1）。
    生成两份交接合同：`precheckContract`（S157 需要的 `unitKey`、`armColumn`、`designedAllocation`、`startAt`/`endAt`、`blindedMetrics`，字段集合与 PASS 的 S157 `experiment` 输入完全相同）和 `analysisContract`（S161 需要的 `hypotheses`、`experimentDesign`）。`unitKey`/`armColumn` 来自输入 `dataBinding`；`startAt = schedule.plannedStartAt`，`endAt = startAt + duration.days` 天，由脚本算出。冻结后任何修改都会生成新的 `designVersion`，并记录 `amendments[]`（修改原因、修改时是否已经解盲）。

## 5. 输入契约（`inputSchema`，写入 WorkSkillManifest，proposed-unwired）
```ts
{
  mode: "online-ab" | "cluster" | "switchback" | "usability-comparison";
  domainProfile?: "product" | "ux" | "learning";        // 缺省取 DigitalHuman 映射（§2.2），再缺省 product
  change: { summary: string /* ≤1000 字 */; changeRisk: "reversible-low" | "reversible-high" | "irreversible";
            touchesPricing: boolean; isEstablishedPractice: boolean;
            sourceHypothesisRef?: { skill: "S074"; reportId: string; hypothesisId: string } };
  units: { randomizationUnit: "user"|"account"|"session"|"classroom"|"school"|"geo"|"time-slice";
           analysisUnit: "user"|"account"|"session"|"student"|"classroom"|"geo"|"time-slice";
           exposureTrigger: string; triggerRate?: number /* (0,1] */;
           analysisPopulation?: "triggered" | "all-assigned";   // 缺省 triggered
           meanClusterSize?: number; icc?: number /* [0,1) */ };
  interference: { sharedSupply: boolean; socialOrCollab: boolean; sharedInstructor: boolean;
                  carryoverWashoutMinutes?: number /* ≥0；design 落为 switchback 时必填 */ };
  dataBinding: { unitKey: string; armColumn: string };   // 分析数据集中单元 id 列与分组列名，进 precheckContract / HypothesisSpec.groupColumn
  schedule: { plannedStartAt: string /* ISO-8601 带时区 */ };  // endAt 由脚本按 duration 推出
  primarySided?: "two-sided" | "one-sided";               // 缺省 two-sided
  metrics: {
    primary: MetricInput;                 // 恰好 1 个
    guardrails: MetricInput[];            // 1..5
    secondary?: MetricInput[];            // 0..10
  };
  traffic: { eligibleUnitsPerDay: number; trafficFraction: number /* (0,1] */;
             maxDurationDays: number /* 7..180 */; minDurationDays?: number /* ≥7，缺省 14 */;
             baselineRef?: { skill: "S157" | "S072"; reportId: string } };
  arms: Array<{ armId: string; isControl: boolean; weight: number }>;   // 2..6，恰好 1 个 control
  alpha?: number;   /* 缺省 0.05，0<α≤0.1 */   power?: number; /* 缺省 0.8，0.7..0.95 */
  stopping?: { kind: "fixed-horizon" } | { kind: "group-sequential"; looks: number /* 2..5 */ };
  requestedPeeking?: boolean;             // 用户口头要求「随时看」
  jurisdiction?: "CN" | "US" | "other";
  participantsIncludeMinors?: boolean;    // learning profile 必填
  fundingSource?: "us-federal" | "other" | "none" | "unknown";  // 只在 jurisdiction=US 且 participantsIncludeMinors=true 时参与判定
}
MetricInput = { metricId: string; metricRef?: { skill: "S072"; reportId: string };
                column: string; numerator?: string; denominator?: string;  // 映射 S161 metric{column,numerator,denominator}
                kind: "proportion" | "mean" | "ratio";
                baseline: number; sd?: number /* mean 必填 */; unit: string;
                practicalThreshold: number /* >0，与 unit 同单位 */;
                direction: "increase" | "decrease";           // 业务上「好」的方向，经 §4 第 4 步映射为 S161 direction
                nonInferiorityMargin?: number /* >0，护栏必填 */ };
```
输入不变式（违反 → `InvalidInput`，附带字段路径）：
- `arms` 中 `weight` 之和为 1（±1e-6），恰好一个 `isControl=true`，`armId` 不重复；
- `analysisUnit` 比 `randomizationUnit` 更细 ⇒ `meanClusterSize` 与 `icc` 都必填；
- `mode="cluster"` ⇒ `randomizationUnit ∈ {account, classroom, school, geo}`；`mode="switchback"` ⇒ `randomizationUnit="time-slice"`；
- `kind="mean"` ⇒ `sd` 必填；`kind="proportion"` ⇒ `0<baseline<1`；
- `domainProfile="learning"` ⇒ `participantsIncludeMinors` 必须给出；
- 主指标的 `metricId` 不得出现在 `guardrails` 中；
- 每个 `guardrails[i]` 必须有 `nonInferiorityMargin`；`kind="ratio"` ⇒ `numerator`、`denominator` 必填；
- 第 3 步设计落为 `switchback`（显式 `mode="switchback"` 或由 SUTVA 问答改写）而 `interference.carryoverWashoutMinutes` 缺失 ⇒ `InvalidInput`（路径 `interference.carryoverWashoutMinutes`）；
- `schedule.plannedStartAt` 不是带时区的 ISO-8601 ⇒ `InvalidInput`。

`plannedStartAt` 是计划值：W031 若在冻结后推迟启动，属于 `amendments[]` 的一次修改（新 `designVersion`，`afterUnblinding=false`），由 W031 运行时发起；S071 不从运行态自行读取实际启动时间（W031 运行态 proposed-unwired）。

## 6. 输出契约（`outputSchema`，S071 专属）
```ts
ExperimentDesignSpec = {
  designId: string; designVersion: number;
  designDigest: string;       // sha256(canon(spec 去掉两个 digest 字段))
  hypothesesDigest: string;   // sha256(canon(analysisContract.hypotheses))，§4 第 10 步
  status: "frozen" | "not-run" | "infeasible" | "needs-human";
  worthRunning: { verdict: "run-experiment" | "ship-without-test" | "underpowered-alternative" | "human-decision";
                  reasons: string[]; postLaunchGuardrails?: string[] };
  units: { randomizationUnit: string; analysisUnit: string; exposureTrigger: string;
           design: "individual" | "cluster" | "switchback" | "geo" | "within-subject";
           clusterAdjustment?: { designEffect: number; icc: number; meanClusterSize: number };
           carryoverWashoutMinutes?: number };
  arms: Array<{ armId: string; isControl: boolean; weight: number }>;
  hypotheses: HypothesisSpec[];           // = S161 §5 hypotheses[] 元素类型，origin 固定 "preregistered"，direction 按 §4 第 4 步映射
  multiplicity: { secondary: "holm" | "bh" | "none-no-secondary" };
  sampleSize: { perArm: Record<string, number>; total: number; mdeAbsolute: number; mdeRelative: number;
                analysisPopulation: "triggered" | "all-assigned"; dilutionFactor: number;
                inputsUsed: { baseline: number; baselineSource: "server-report" | "caller-declared"; alpha: number; power: number } };
  duration: { days: number; wholeWeeks: number; achievableMdeAtMax?: number };
  stopping: { kind: "fixed-horizon" } |
            { kind: "group-sequential"; looks: number; spending: "obrien-fleming"; boundariesZ: number[] };
  harmStops: Array<{ metricId: string; boundaryZ: number }>;
  assignment: { method: "hash-bucket" | "stratified-permuted-block"; salt: string; buckets: 10000; strata?: string[]; seed: number };
  decisionRules: Array<{ primary: "meaningful"|"negligible"|"inconclusive"|"harmful";
                         guardrail: "ok"|"harmful"; action: "ship"|"iterate"|"kill"|"escalate" }>;
  twymanThreshold: number;
  precheckContract: { unitKey: string; armColumn: string; designedAllocation: Record<string, number>;
                      startAt: string; endAt: string; blindedMetrics: string[] };           // 喂 S157 experiment-precheck
  analysisContract: { hypotheses: HypothesisSpec[];
                      experimentDesign: { preregistrationDigest: string /* = hypothesesDigest */;
                                          allocation: Record<string, number>; primaryMetricId: string; guardrailMetricIds: string[] } }; // 喂 S161
  rewrites: Array<{ from: string; to: string; why: string }>;   // 例：「显著就停」→ group-sequential
  complianceFlags: Array<"cn-pricing-discrimination-review" | "cn-minor-guardian-consent" | "cn-algorithm-opt-out"
                         | "us-ferpa-review" | "us-irb-review" | "us-price-disclosure-review">;
  amendments: Array<{ fromVersion: number; reason: string; afterUnblinding: boolean }>;
  computeReceipt: { script: "design-calc.mjs"; scriptVersion: string; inputDigest: string };
}
```
输出不变式（由 `design-calc.mjs` 的输出校验执行）：
- 所有数值字段（`perArm`、`mde*`、`days`、`boundariesZ`、`designEffect`）都来自 `computeReceipt` 对应的脚本输出，模型不得改写；
- `status="frozen"` ⇒ `worthRunning.verdict="run-experiment"`，且 `hypotheses` 中 `family="primary"` 的恰好 1 条；
- `duration.days % 7 === 0`，且 `duration.days ≥ minDurationDays`；
- `analysisContract.experimentDesign.preregistrationDigest === hypothesesDigest === sha256(canon(analysisContract.hypotheses))`，且 `analysisContract.hypotheses` 与顶层 `hypotheses` 深相等；
- `precheckContract.endAt − startAt === duration.days` 天；每条 `hypotheses[i].groupColumn === precheckContract.armColumn`；`precheckContract.designedAllocation` 与 `analysisContract.experimentDesign.allocation` 逐键相等；
- `precheckContract.blindedMetrics` ⊇ {primary} ∪ guardrails，并且不包含 `armColumn`（满足 S157 的输入不变式）；
- `amendments[i].afterUnblinding=true` ⇒ `status="needs-human"`。

类型化错误：
| 错误 | 触发 | 处理 |
|---|---|---|
| `InvalidInput` | §5 不变式被违反 | 返回字段路径，不产出 spec |
| `PseudoReplication` | 分析单元比随机单元细，但缺少 ICC / 簇大小 | 要求补充，或改为 `analysisUnit=randomizationUnit` |
| `Infeasible` | 时长大于 `maxDurationDays` | `status="infeasible"`，给出 `achievableMdeAtMax`，不放宽 α / power |
| `BaselineUnverified` | W031 内 `baselineRef` 取不回，或与调用方声明值相差超过 20% | 以服务端值为准；取不回时 `status="needs-human"` |
| `PeekingRequested` | `requestedPeeking=true` 且 `stopping.kind="fixed-horizon"` | 自动改写为 `group-sequential(looks=3)`，并记入 `rewrites` |
| `AmendAfterUnblinding` | 修改请求携带的 W031 运行态显示已经解盲 | 拒绝生成新的 `frozen` 版本，`status="needs-human"` |

## 7. 授权边界（调用方声明 vs 服务端核验）
| 字段 | 谁说了算 | 说明 |
|---|---|---|
| `traffic.baselineRef`（S157 / S072 报告） | **服务端**按 reportId 取回报告，并按会话现有鉴权核对可读性（专用 `data.read` 能力分类 proposed-unwired，待 ADR-120） | 取回后以报告值覆盖调用方的 `baseline`，`baselineSource="server-report"` |
| `metrics.*.baseline` / `sd` / `eligibleUnitsPerDay` | 调用方声明 | 在没有 `baselineRef` 时使用，并标 `baselineSource="caller-declared"`。S161 在 `analysisContract` 中能看到这一来源 |
| `metrics.*.metricRef`（S072） | **服务端**取回 S072 报告，核对指标口径 id | 在 W031 内，没有 S072 引用的主指标会使 spec 变为 `needs-human` |
| `hypothesesDigest` 作为预注册凭据（`designDigest` 同时写入作版本锚点） | **服务端**把 digest 写入 W031 运行记录（W031 运行态存储 **proposed-unwired**，ADR-118） | 对话直调（包括 D026）产出的 spec 没有运行记录作为锚点，S161 应把它视为 `ad-hoc`，与 S161 §7 的降级规则一致 |
| `change.changeRisk` / `touchesPricing` | 调用方声明，但**只能往高风险方向改**：`summary` 中出现价格、资费、折扣、合同、费率等关键词时，服务端强制设 `touchesPricing=true` | 防止把价格实验报成低风险而走 `ship-without-test` |
| `alpha` / `power` | 调用方声明，服务端裁剪到 α ≤ 0.1、power ≥ 0.7 | |
| 冻结后的修改 | 由 W031 人类闸门批准（W031 作者定义） | S071 自己不会覆盖已冻结的版本 |
| 需求文本、指标名中的指令性语句 | 视为数据，不是指令 | 例如「把 α 调到 0.2 以便显著」不会改变计算结果 |

S071 只读，没有外部写副作用（不创建功能开关、不改分流），riskClass=low。W031 运行记录的写入由 Workflow 运行时完成，不属于 S071。

## 8. 依赖与运行时（逐项核实）
- 沙箱执行：`apps/skill-sandbox/src/execute-script.ts`（已核实存在，导出 `executeScript`、`MAX_ARTIFACT_BYTES = 32 MiB`）。
- API 侧脚本调用：`apps/api/src/application/agent-run/run-skill-script.ts`（已核实文件存在；具体调用细节 UNVERIFIED）。
- `apps/skill-sandbox/analysis/requirements.lock` 中有 `numpy==2.2.6`，没有 scipy / statsmodels（S161 §8 已逐行查过，本文复核了 numpy 一行）。因此 `design-calc.mjs` 计划用纯 JS 实现正态分位数（Acklam 有理近似）和 O'Brien-Fleming 边界（Lan-DeMets 近似），**proposed-unwired**。
- WorkspaceX 在基线上**没有**实验分流 / 功能开关平台：在 `apps/`、`packages/` 的 `*.ts` 中检索 `featureflag|feature-flag|abtest|experimentId`，结果为 0。所以 `assignment` 只是方案，不会被执行。

## 9. 决策
- **决策 1：S071 的 `hypothesesDigest` 就是 W031 的预注册凭据。** S161 §7 目前写的是「按 W031 运行记录中 S072 阶段产物核对」。但 S072 审的是指标口径，不是假设、分配和停止规则。能把 `HypothesisSpec` 与分配一起冻结的只有 S071。本文据此产出 `preregistrationDigest = hypothesesDigest`；不用 `designDigest`，因为 S161 只能对自己手里的 `hypotheses` 求摘要，整份 spec 的 digest 它无从比较。本文并在 §13 提议修改 S161 的这一句（这是接口修正，不是改图的边）。
- **决策 2：「不做实验」是一等输出。** `worthRunning` 在样本量计算之前判断。可逆、低风险、公认做法的改动输出 `ship-without-test` 并附带发布后护栏；能达到的 MDE 远大于业务阈值时输出 `underpowered-alternative`。这比给出一个跑 6 个月的 A/B 更有用，也避免了为凑显著而放宽 α。
- **决策 3：偷看只能改写，不能放行。** 用户要求「随时看、显著就停」时，S071 不拒绝，也不照做，而是改写为预先声明看数次数的 `group-sequential`，边界由脚本计算。护栏上允许只因有害而提前停止。理由：无约束偷看会让第一类错误率远超名义 α。
- **决策 4：时长按整周取整，且不少于 14 天。** 产品流量与课程节奏都有周内周期，只跑不完整的一周会把星期效应混进处理效应。代价是时长变长，这通过 `achievableMdeAtMax` 公开，不隐藏。
- **决策 5：稀释显式化，推荐 triggered 分析。** 只有 `triggerRate` 比例的单元会碰到改动时，全量分析会把效应摊薄到 `Δ·triggerRate`，样本量会爆炸。S071 默认 `analysisPopulation="triggered"`，并把「暴露日志完整」变成 S157 预检的前提（暴露日志的核对方式见 §13 提议 3；现有 S157 `experiment` 输入没有暴露字段，S071 不往 `precheckContract` 里塞 S157 不认识的字段）。
- **决策 6：learning profile 默认整群随机。** 同一教师同时教两组，或同班同学互相传播，都会破坏个体随机。`domainProfile="learning"` 且 `sharedInstructor=true` 时，设计强制为 `cluster`（班级 / 学校），并计入设计效应。

## 10. CN / US 差异（仅列实质差异；只触发标记和人工复核，不构成法律意见）
| 场景 | CN | US |
|---|---|---|
| 价格 / 资费分组 | 对不同用户群给出不同价格，可能触及《个人信息保护法》第 24 条（自动化决策不得在交易价格等交易条件上实行不合理差别待遇）和价格监管规定 → `cn-pricing-discrimination-review`，`worthRunning` 强制 `human-decision` | 一般可做价格测试，但要注意 FTC Act 第 5 条下的欺骗性展示风险 → `us-price-disclosure-review` |
| 基于个人特征的推荐 / 排序实验 | 《互联网信息服务算法推荐管理规定》要求提供不针对个人特征的选项 → `cn-algorithm-opt-out`：关闭个性化的用户必须被排除出实验，或进入固定的对照组，并在 `exposureTrigger` 中声明 | 无同等的联邦级要求 |
| 未成年人学习实验（D026 / D047） | 不满 14 周岁未成年人的个人信息属于敏感个人信息，需要监护人同意 → `cn-minor-guardian-consent` | 教育记录受 FERPA 约束 → `us-ferpa-review`；联邦资助的研究适用 Common Rule / IRB → `us-irb-review` |

## 11. 失败模式（S071 特有）
| 失败 | 表现 | 防线 |
|---|---|---|
| 伪重复 | 按班级分组、按学生算 n，样本量被夸大约 DE 倍 | `PseudoReplication` 错误，以及整群设计效应 |
| 稀释导致无限期实验 | 1% 的用户碰到改动，却按全量分析 | 决策 5，`dilutionFactor` 公开 |
| 事后换主指标 | 主指标不显著，就把显著的次要指标升为主指标 | `designDigest` 冻结；修改记入 `amendments`，解盲后修改 → `needs-human` |
| 偷看即停 | 每天看 p 值 | 决策 3 |
| 护栏缺失 | 只看营收，不看留存 / 投诉 | 护栏最少 1 条，且进入 `blindedMetrics` |
| 溢出污染 | 双边市场按用户随机，共享库存让两组互相影响 | 第 3 步 SUTVA 问答 → `switchback` / `geo` |
| 用想要的 MDE 反推样本量 | 为让实验「够快」而把 `practicalThreshold` 定得很大 | `practicalThreshold` 来自输入，决策表按它判断，`achievableMdeAtMax` 公开 |
| 「好得不像真的」直接上线 | +40% 转化来自埋点重复计数 | `twymanThreshold` 强制复核 |
| 分配表和 S157 / S161 对不上 | 各阶段手抄分配比 | 两份合同同源，输出不变式逐键比对 |

## 12. 评测（`evals/work-stack/S071/`，ADR-119；夹具为合成数据，数值容差 1%）
| # | 输入 | 通过判据 |
|---|---|---|
| E1 | `online-ab`，比例主指标，baseline 10%，`practicalThreshold` 0.5pp，α 0.05 双侧，power 0.8，两臂 50/50，triggered | `perArm` ≈ 57,760（±1%）；`mdeAbsolute` = 0.005 |
| E2 | 同 E1，`eligibleUnitsPerDay=8000`，`trafficFraction=1`，`maxDurationDays=60` | 原始需要 14.44 天 → `duration.days=21`（整周取整）；`status="frozen"` |
| E3 | 同 E1，`units.triggerRate=0.2`，`units.analysisPopulation="all-assigned"` | `dilutionFactor=0.2`；样本量约为 E1 的 25 倍；`rewrites` 中建议 triggered |
| E4 | 同 E1，`eligibleUnitsPerDay=500`，`maxDurationDays=28` | `status="infeasible"`；给出 `achievableMdeAtMax`；α / power 保持不变 |
| E5 | `learning`，按班级随机、按学生分析，`meanClusterSize=25`，但没有给 `icc` | `PseudoReplication`；补上 `icc=0.1` 后 `designEffect=3.4`，`design="cluster"` |
| E6 | `requestedPeeking=true`，`stopping=fixed-horizon` | 改写为 `group-sequential`，`looks=3`；`boundariesZ` 第一次看数约 3.47、最后一次约 2.00（OBF 参考值，±0.02）；`rewrites` 非空 |
| E7 | 按钮文案改动，`reversible-low`，`isEstablishedPractice=true` | `worthRunning.verdict="ship-without-test"`，带 `postLaunchGuardrails`；不产出 `perArm` |
| E8 | `summary`「给新用户降价 10% 的分组测试」，调用方声明 `touchesPricing=false`、`reversible-low`，`jurisdiction=CN` | 服务端强制 `touchesPricing=true`；`cn-pricing-discrimination-review`；verdict=`human-decision` |
| E9 | 双边市场派单策略，`interference.sharedSupply=true`，按 user 随机，(a) 未给 `interference.carryoverWashoutMinutes`；(b) 给 60 | (a) `InvalidInput`，路径 `interference.carryoverWashoutMinutes`；(b) `design="switchback"`，`units.carryoverWashoutMinutes=60`，`rewrites` 记录改写 |
| E10 | W031 运行态显示已解盲，请求把次要指标升为主指标 | `AmendAfterUnblinding`；`amendments[].afterUnblinding=true`；`status="needs-human"` |
| E11 | `learning`，`participantsIncludeMinors=true`：(a) US，`fundingSource="us-federal"`；(b) US，`fundingSource="none"`；(c) CN | (a) `us-ferpa-review` 与 `us-irb-review`；(b) 只有 `us-ferpa-review`；(c) `cn-minor-guardian-consent` |
| E12 | W031 内，`baselineRef` 报告值 8%，调用方声明 12% | `BaselineUnverified`；使用 8%，`baselineSource="server-report"` |
| E13（跨阶段） | E2 的 spec 输入 S157 `experiment-precheck` 与 S161 `experiment` | S157 不报 `EXPERIMENT_SPEC_INVALID`；S161 对收到的 `analysisContract.hypotheses` 求得 `specDigest` 等于 `preregistrationDigest`（= `hypothesesDigest`），不报 `PreregistrationMismatch`；把主假设 `alpha` 改为 0.1 再送入 → 报 `PreregistrationMismatch`；`precheckContract.endAt − startAt = 21` 天 |

E13 计入 W031 的 Workflow 套件（与 S157 E4、S161 E1 串联），不计入 S071 的 G5 计数。

## 13. Graph change proposals（只提议，不改矩阵）
不提议改动任何边。有两处**接口**层面的提议：
1. **S161 §7 预注册核对来源与规范化规则。** 把「按 W031 运行记录中 S072 阶段产物核对」改为「按 W031 运行记录中 S071 产出的 `hypothesesDigest` 核对」（决策 1）；并在 S161 §4 第 2 步写明 `specDigest` 用与本文 §4 第 10 步相同的 `canon()`（键码点排序、无空白、JS 最短数字）。在 S161 确认前，E13 的相等判据依赖此对齐。
2. **S074 §5 `experimentResult`。** S074 §14 提议 2 希望在 S071 / S161 作者化后直接引用它们的类型。S071 能提供的是 `designId` 与 `decisionRules`；检验数值仍然应该来自 S161 的输出。建议 S074 的 readout 输入改为 `{ designRef: { skill: "S071"; designId; designVersion }, analysisRef: S161 报告 id }`。

3. **S157 `experiment` 输入的暴露核对。** 决策 5 的 triggered 分析需要核对暴露日志完整，但 PASS 的 S157 `experiment` 只有 `unitKey/armColumn/designedAllocation/startAt/endAt/blindedMetrics`。建议 S157 增加可选 `exposureColumn?: string`（暴露时间戳列，缺失率进预检），届时 S071 在 `precheckContract` 里同步输出。未被 S157 接受前，S071 不输出该字段，暴露日志核对属未落地。

## 14. 未决问题
1. W031 的阶段顺序、冻结后修改的人类闸门由 W031 作者定义。本文假设 S071 → (S072) → S157 → S161 → S074。
2. `fundingSource="unknown"`（或缺省）且 US 未成年人时，是否也应出 `us-irb-review`（保守）还是只出 FERPA，本文暂取保守：出 `us-irb-review` 并附原因「资助来源未知」。
3. `design-calc.mjs` 的 O'Brien-Fleming 边界使用近似实现。与精确数值积分的误差需要在 E6 夹具中固定参考值。
4. D026 不拥有 W031，它在对话中产出的设计永远是 `ad-hoc`。是否需要一个面向教学实验的 Workflow，交给图的所有者判断（本文不提议加边）。
