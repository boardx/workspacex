# S074 — User Activation（用户激活）

> Type: Work Skill · Domain: Product · Strategy: A1（两源择优合并）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文中「已核实」的代码路径都在该 SHA 上用 `git show` / `git cat-file -e` 读过；其余一律标 **UNVERIFIED** 或 **proposed-unwired**。
> 独立作者化（AUTHOR-S074）。v1 的 S074 只用作话题清单，正文没有沿用。

## 1. 这个 Skill 解决什么问题
S074 只回答三个问题：
1. **激活定义**：在这个产品里，「激活」应该是哪一个行为，做到多少次，在多长的窗口内完成？
2. **激活诊断**：新用户卡在激活前的哪一步，哪个分群卡得最多，从注册到激活要多久？
3. **激活读数**：一次实验或上线把激活率拉高之后，留存有没有跟着变？还是只是把激活门槛做低了？

它的产物是一份 `ActivationReport`：
- 一个**经留存验证**的激活定义（行为 + 阈值 + 窗口 + 分析单位）；
- 一张带删失处理的激活漏斗；
- 若干条**待实验**的假设。

S074 **不做**的事：
- 实验设计、样本量和随机化（S071 Experiment Design）；
- 全量指标体系的周期回顾（S072 Metrics Review，它只**引用** S074 的激活定义）；
- 通用探索性分析（S157 Data Exploration）和显著性检验本身（S161 Statistical Analysis）；
- 上线计划（S073 Product Launch）；
- 直接改 onboarding 界面或给用户推送消息（没有写能力，见 §7）。

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行 | 矩阵原文 |
|---|---|---|
| W031 Experiment Loop | 第 37 行 | `S071, S072, S157, S161, S074`（Domain: Product） |

S074 在两张矩阵上只有这一个 Workflow 消费者。矩阵只给出集合，不规定阶段顺序；阶段顺序由 W031 作者决定（W031 在本文作者化时还没有 v2 文档）。S074 在 W031 里能用的模式如下：
- 实验开始前：`define`（定义要被实验移动的激活指标）、`diagnose`（找出该拿来做实验的卡点）；
- 实验结束后：`readout`（读 S161 的检验结果，判断激活提升有没有传导到留存）。

具体用哪几个模式，由 W031 的阶段映射决定。S074 不假设 W031 一定会调用全部三个。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
| DigitalHuman | 矩阵行 | 所在列 |
|---|---|---|
| D003 Product Manager | 第 9 行 | Skill 列（该行共 14 个 Skill，S074 为其中之一） |

- 按 ADR-118 决策 9，Skill 列只列在对话里**直接调用**的 Skill。D003 挂载 S074，是因为 PM 会在对话中直接问「我们的激活指标该怎么定」「新用户卡在哪」，这与 D003 拥有 W031 无关。
- D011 Design Thinking Expert 拥有 W031（第 17 行），但它的 Skill 列里没有 S074。按决策 9，D011 在 W031 的阶段里仍然可以使用 W031 锁定的 S074 版本，不需要补挂载边。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| RefoundAI/lenny-skills | `skills/user-onboarding-activation/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | 仓根 `LICENSE` 为 MIT（Copyright 2025 Refound AI）；但正文 :22–:52 是播客嘉宾的逐字引语，引语本身的版权不在该 MIT 授权范围内 → **reference-only** | 借用四个话题：:14「激活里程碑必须与长期留存相关」、:49「到达者留存必须显著高于未到达者」、:83「门槛太低：80% 都到达但留存仍低」、:63–:64「B2B 多角色 aha（团队 / 买方）」「aha 与 habit 的区分」。**不复制**任何引语或段落，只把它们落成 §4 的可计算规则。 |
| anthropics/knowledge-work-plugins | `product-management/skills/metrics-review/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`product-management/LICENSE`） | adapt：:135–:137「激活率 + 激活耗时」两个 L1 指标；:202「按激活行为切分留存」；:233「A/B 测激活流程时衡量留存，而不只看激活率」→ 落成 `readout` 模式和决策 5。NOTICE 与改动说明写在 SKILL.md 的 `references/upstream.md` 里（Apache-2.0 §4(b)(c)）。 |

- 两源并用的理由（A1）：lenny 提供「定义要被留存验证」的判据，但没有计算方法；kwp 提供指标位置与读数纪律，但没有「门槛过低」的检测。§4 的确定性规则（覆盖带、精确率/召回率、删失）两源都没有，由本文补上。
- 两个 clone 都在 `/tmp/claude-0/-home-user-workspacex/73cf4d09-4f20-5254-be5a-96afdef9f330/scratchpad/upstream/{lenny-skills,knowledge-work-plugins}`，commit 用 `git rev-parse HEAD` 读出。

## 4. 专业方法（S074 专属步骤）
### 4.1 共同前置
- **P1 锁定分析单位**：`unit ∈ {user, account}`。
  - B2B 协作产品的激活往往发生在 account（团队 / 组织）层，例如「团队里第二个人加入」。
  - 同一份报告只允许一种 unit。user 级行为要用在 account 级定义里，必须写成聚合规则（如「account 内 ≥2 名 user 做过 X」），不能混算（决策 4）。
- **P2 留存定义先于激活定义**：
  - 必须先给出 `retention = {event, horizonDays, activeRule}`，例如「第 28–35 天内有任意一次 `core_action`」。
  - 没有留存定义就不能验证激活，直接返回 `RETENTION_DEFINITION_MISSING`，不能拿「看起来重要的行为」代替。
- **P3 删失**：
  - 注册日 + 激活窗口 + 留存 horizon 超过数据截止日的主体属于**右删失**，不进入该候选的分母；
  - 删失人数写进 `censored`（决策 6）。
- **P4 同意覆盖**：
  - 输入必须声明 `consentCoverage`，即埋点同意前事件是否丢失、丢失比例是否已知；
  - 未知时漏斗顶部必须标 `topOfFunnelBiased=true`（§9）。
- **P5 模型只看聚合**：user 级 / account 级的行数据只进 `apps/skill-sandbox` 里运行的 `scripts/activation-metrics.mjs`，模型上下文只拿到脚本输出的聚合表（决策 2）。

### 4.2 `define` 模式：找出并验证激活定义
1. **候选枚举**：
   - 候选 = `(event ∈ 输入 taxonomy) × (threshold ∈ {1,2,3,5}) × (windowDays ∈ {1,3,7,14})`；
   - 调用方也可以另给 `candidates[]`；
   - 不在 taxonomy 里的事件返回 `EVENT_NOT_IN_TAXONOMY`，不能用自然语言猜映射。
2. **逐候选计算**（脚本，确定性）：
   - `coverage` = 到达者 / 未删失主体；
   - `retainedIfReached`、`retainedIfNot`、`lift` = 前者减后者（百分点）；
   - `precision` = 到达者中留存的比例；
   - `recall` = 留存者中到达的比例。
3. **硬过滤**：
   - `coverage ∉ [0.15, 0.85]` → 淘汰，理由 `bar-too-low` 或 `bar-too-high`（这条规则来自 lenny :83，数值区间由本文确定，见 §15）；
   - 任一格子 < k（默认 k=20）→ 淘汰，理由 `small-cell`；
   - `lift` 的 95% CI（Wilson 差值区间）跨 0 → 淘汰，理由 `no-lift`。
4. **选择**：
   - 在剩余候选里取 `F1 = 2PR/(P+R)` 最大者；
   - 并列时依次取窗口更短、阈值更低的那个（更早可观测，更早可干预）；
   - 同时输出前 3 名作为 `runnersUp`。
5. **因果标记**：选出的定义一律标 `causalStatus: "correlational"`。只有 `readout` 模式能把它改成 `experiment-supported`（决策 1）。
6. **aha / habit 区分**：
   - 若最佳候选的 `windowDays ≥ 14` 且 `threshold ≥ 3`，标 `kind: "habit"`，并要求再给一个 `windowDays ≤ 3` 的 `kind: "aha"` 候选（取它自己的 F1 最优）；
   - 如果找不到这样的 aha 候选，写入 `gaps`。

### 4.3 `diagnose` 模式：漏斗与卡点
1. 漏斗步骤来自输入的 `funnelSteps[]`（有序）。`ordered=true` 时，只有前一步已完成的主体才进入下一步的分母。
2. 每一步输出：`reached`、`conversionFromPrev`、`medianMinutesFromStart`（只统计到达者），以及 `withinBudget`（若给了 `timeBudgetMinutes`）。
3. **耗时的删失**：
   - 还没到达、观察期也还没结束的主体不计入中位数；
   - 这类主体的数量写进 `stillOpen`，不得当作「未到达」。
4. **分群**：
   - 只按输入里声明的 `segmentKeys` 切（如 `platform`、`acquisitionChannel`、`persona`）；
   - 小于 k 的格子合并进 `other`，并标 `suppressed=true`。
5. **卡点排序**：按「该步流失的绝对主体数 × 该步到达者的后续激活率」排序，取前 3 个作为 `dropOffs`。每个卡点至少附一个分群对比，说明是全员都卡在这里，还是某个分群特别卡。
6. **假设**：
   - 每个卡点可以生成 0–2 条 `hypotheses`，格式固定为「若把 X 改成 Y，则 <步骤> 的转化上升，因为 <来自数据的观察>」；
   - 每条都带 `targetMetric`（必须是本报告的激活定义）和 `guardrail`（必须是留存定义）；
   - 这些假设是交给 S071 的输入，不是建议；
   - 不写 UI 文案，不写「应当」（决策 5）。

### 4.4 `readout` 模式：实验后的激活读数
1. 输入是实验各臂的激活率与留存率，以及 S161 的检验结果（字段见 §5 `experimentResult`）。S074 不重做检验。
2. 判定矩阵：

   | 激活 Δ 显著 | 留存 Δ 显著且同向 | 判定 `verdict` |
   |---|---|---|
   | 是 | 是 | `activation-transfers`，定义可升级为 `experiment-supported` |
   | 是 | 否（不显著） | `activation-only`：可能把门槛做低了，定义**不升级** |
   | 是 | 反向显著 | `activation-harms-retention`：必须上报人类 |
   | 否 | — | `no-activation-effect` |

3. 当留存 horizon 还没走完时（`retentionMatured=false`），verdict 只能是 `pending-retention`，不能提前给出 `activation-transfers`。

## 5. 输入契约（`inputSchema`）
```ts
UserActivationInput = {
  mode: "define" | "diagnose" | "readout";
  locale: "zh-CN" | "en-US";
  jurisdiction?: "CN" | "US" | "other";
  unit: "user" | "account";
  dataset: {
    datasetRef: string;                 // 服务端数据集句柄，不是文件路径；授权见 §7
    dataCutoff: string;                 // ISO datetime，删失计算的截止点
    subjectIdKind: "pseudonymous";      // 唯一合法值；服务端校验，见 §7
    eventTaxonomy: Array<{ event: string; description: string }>;
    consentCoverage: { preConsentEventsDropped: boolean | "unknown"; droppedShare?: number };
  };
  retention: { event: string; horizonDays: number; activeRule: "any" | { minCount: number } };  // define/readout 必填
  candidates?: Array<{ event: string; threshold: number; windowDays: number; accountRule?: { minUsers: number } }>;
  funnelSteps?: Array<{ stepId: string; event: string }>;   // diagnose 必填，≥2
  ordered?: boolean;                    // 默认 true
  timeBudgetMinutes?: number;
  segmentKeys?: string[];               // ≤3
  activationDefinitionRef?: string;     // diagnose/readout：引用已有 ActivationDefinition.definitionId
  experimentResult?: {                  // readout 必填
    experimentId: string;
    arms: Array<{ armId: string; n: number; activated: number; retained: number | null }>;
    activationTest: { pValue: number; ciLow: number; ciHigh: number; alpha: number };
    retentionTest: { pValue: number; ciLow: number; ciHigh: number; alpha: number } | null;
    retentionMatured: boolean;
  };
  kMin?: number;                        // 默认 20，只允许调高
}
```
**不变量**：
- `mode=define` ⇒ `retention` 必填；
- `mode=diagnose` ⇒ `funnelSteps.length ≥ 2`；
- `mode=readout` ⇒ `experimentResult` 与 `activationDefinitionRef` 都必填；
- 所有 `event` 都属于 `eventTaxonomy`；
- `kMin ≥ 20`。

`experimentResult` 的字段由本文暂定。S161 / S071 作者化之后以它们的输出类型为准，S074 改为直接消费、不设适配层（§14 提议 2）。

## 6. 输出契约（`outputSchema`，S074 专属）
```ts
ActivationReport = {
  reportId: string; mode: Mode; unit: "user" | "account"; locale: Locale;
  datasetRef: string; dataCutoff: string;
  population: { subjects: number; censored: number; excludedPreConsent: number | "unknown" };
  topOfFunnelBiased: boolean;
  definition?: {                        // define 产出；diagnose/readout 回显被引用的定义
    definitionId: string;
    event: string; threshold: number; windowDays: number; accountRule?: { minUsers: number };
    kind: "aha" | "habit";
    causalStatus: "correlational" | "experiment-supported";
    evidence: { coverage: number; retainedIfReached: number; retainedIfNot: number;
                lift: number; liftCi95: [number, number]; precision: number; recall: number; f1: number };
    retention: { event: string; horizonDays: number };
  };
  runnersUp?: Array<{ event: string; threshold: number; windowDays: number; f1: number }>;
  rejected?: Array<{ event: string; threshold: number; windowDays: number;
                     reason: "bar-too-low" | "bar-too-high" | "small-cell" | "no-lift" }>;
  funnel?: Array<{ stepId: string; reached: number; conversionFromPrev: number | null;
                   medianMinutesFromStart: number | null; withinBudget?: number; stillOpen: number }>;
  dropOffs?: Array<{ stepId: string; lost: number; score: number;
                     segmentContrast: { key: string; worst: string; best: string; gapPp: number } | null }>;
  hypotheses?: Array<{ hypothesisId: string; dropOffStepId: string; statement: string;
                       targetMetric: string /* = definition.definitionId */; guardrail: string /* retention */ }>;
  readout?: { experimentId: string;
              verdict: "activation-transfers" | "activation-only" | "activation-harms-retention"
                     | "no-activation-effect" | "pending-retention";
              escalate: boolean };      // activation-harms-retention ⇒ true
  suppressedCells: number;
  gaps: string[];                       // 例：「无 ≤3 天的 aha 候选」
  computeReceipt: { script: "activation-metrics.mjs"; scriptVersion: string; inputDigest: string };
}
```
**不变量**（由 `activation-metrics.mjs` 的输出校验执行）：
- 报告里所有数值都来自 `computeReceipt` 对应的脚本输出，模型不得改写数字；
- 任一公开格子的计数 ≥ `kMin`；
- `definition.evidence.coverage ∈ [0.15, 0.85]`；
- `readout.verdict === "activation-harms-retention"` ⇒ `escalate === true`；
- `causalStatus === "experiment-supported"` 只能来自一次 `verdict === "activation-transfers"` 的 readout；
- 不存在 user / account 标识字段；
- 没有 `recommendations`、`uiCopy` 字段（决策 5）。

**类型化错误**（返回错误，不输出部分报告）：

| code | 触发 |
|---|---|
| `ACTIVATION_DATASET_NOT_GRANTED` | 服务端没有授予该 org 对 `datasetRef` 的读权限 |
| `RAW_IDENTIFIER_DETECTED` | 服务端扫描发现数据集含邮箱、手机号或明文 user id |
| `RETENTION_DEFINITION_MISSING` | define/readout 没有给 `retention` |
| `EVENT_NOT_IN_TAXONOMY` | 候选、漏斗或留存事件不在 taxonomy 里 |
| `UNIT_MISMATCH` | 引用的定义 unit 与本次 unit 不同；或 user 级事件在 account unit 下没有 `accountRule` |
| `INSUFFICIENT_COHORT` | 未删失主体 < 5×kMin |
| `ALL_CANDIDATES_CENSORED` | 所有候选的窗口 + horizon 都超过 `dataCutoff` |
| `DEFINITION_NOT_FOUND` | `activationDefinitionRef` 不存在，或属于其他 org |

## 7. 授权边界与依赖（ADR-120）
**调用方的声明 vs 服务端的核实：**

| 项 | 调用方声明（不可信） | 服务端核实（可信） |
|---|---|---|
| org / actor | 请求里的 orgId、角色 | 会话身份 + 组织成员关系 |
| 数据集访问 | `datasetRef` | 该 org 对数据集的读授权（`analytics.read`） |
| 假名化 | `subjectIdKind: "pseudonymous"` | 服务端对数据集元数据和抽样行的扫描；失败返回 `RAW_IDENTIFIER_DETECTED` |
| k 阈值 | `kMin` | 脚本强制 `max(kMin, 20)`；调用方只能调高 |
| 定义归属 | `activationDefinitionRef` | 按 org 做租户内查询 |

**依赖：**
- **required**：`analytics.read`（产品事件 / 留存数据的只读访问）——**proposed-unwired**：
  - ADR-120 的 `capabilityCategory` 在 baseline 代码里不存在（`git grep capabilityCategory` 在 `apps/`、`packages/` 下无命中）；
  - 也没有任何产品分析连接器（如 Mixpanel、Amplitude、神策）。
- **required**：`sandbox.exec`，经 `apps/skill-sandbox` 运行 `scripts/activation-metrics.mjs`：
  - `apps/skill-sandbox` 在 baseline 上存在；
  - 该脚本是 **proposed-unwired**，需要新写。
- **没有写能力**；riskClass = low。
- `analytics.read` 被拒时直接返回 `ACTIVATION_DATASET_NOT_GRANTED`，不改用同类别的其他数据源重试（ADR-120 决策 3），也不退化为「请用户粘贴 CSV」。粘贴上传要作为单独的 `datasetRef` 来源，经同一条假名化扫描。

## 8. 决策
- **决策 1：激活定义默认只是相关性结论，只有实验读数能升级它。**
  - 「到达者留存更高」有很强的选择偏差：本来就投入的用户什么都会做。
  - 所以 `define` 的产出恒为 `causalStatus: "correlational"`，只有 `readout` 里的 `activation-transfers` 能把它升级为 `experiment-supported`。
  - W031 能把 S074 与 S071/S161 放进同一条 Workflow，正是为了让这一步升级有路可走。
- **决策 2：模型不接触行级数据；所有数字都由脚本给出。**
  - 覆盖率、提升、CI、F1、删失，全部由 `activation-metrics.mjs` 计算，每次都有 `computeReceipt`。
  - 理由有两个：
    - 行级事件即使假名化，放进模型上下文仍然扩大了暴露面；
    - LLM 算比例和区间不可复现。
  - E6 用「报告数字与 receipt 重算不一致」作为失败判据。
- **决策 3：用覆盖带淘汰「门槛过低 / 过高」的定义，而不是只看提升。**
  - 纯按 lift 选，会选出只有极少数重度用户做过的行为（覆盖 3%，lift 巨大，但对产品不可干预）；
  - 纯按覆盖选，会选出「完成注册」这类几乎人人都做的行为。
  - [0.15, 0.85] 这个区间加上 F1 选择，是把 lenny :83 的定性警告变成可测的规则。区间数值待回测（§15）。
- **决策 4：一份报告只有一种分析单位。**
  - B2B 产品里，user 级激活和 account 级激活可能指向相反的结论：个人很快上手，但团队始终没有第二个人加入。
  - 混算会让分母失真。因此 `unit` 必填，跨单位引用直接返回 `UNIT_MISMATCH`。
  - WorkspaceX 自己的第一个价值时刻就是组织级定义（§12），这是现成的 account 单位例子。
- **决策 5：S074 只产出假设，不产出 onboarding 方案。**
  - 「做个向导」「减少一步」这类改动，要经过 S071 设计实验、W031 的人类门之后才落地；
  - S074 的假设必须绑定 `targetMetric` 与 `guardrail`，不许写成祈使句；
  - 这样 S073（上线）和 S071（实验）的边界不会被 S074 绕过。
- **决策 6：删失主体从分母中剔除并单独计数，不当作「未激活」。**
  - 最近一周注册的用户还没走完 7 天窗口。把他们算作未激活，会让任何上线后的激活率看起来都在下降。
  - E3 专测这一点。

## 9. CN / US 差异（实质性的部分）
| 方面 | CN | US | 对 S074 的影响 |
|---|---|---|---|
| 埋点前的同意 | PIPL 与 App 个人信息收集的监管实践要求在用户同意隐私政策之前不初始化统计 SDK（**UNVERIFIED**：条文细节需法务确认），首启同意页之前的事件通常整段缺失 | 多数州为 opt-out 模式（CCPA/CPRA），首启事件一般完整；iOS ATT 主要影响跨 App 归因，不影响第一方事件 | CN 数据集的 `consentCoverage.preConsentEventsDropped` 通常为 `true`，漏斗第一步应从「同意后首个事件」开始算，`topOfFunnelBiased` 为 true 时报告必须写明 |
| 首步形态 | 微信 / 手机号一键登录、小程序免注册，「注册」这一步可能根本不存在 | 邮箱 + 验证、SSO 较常见 | 不预设 `signup` 是第一步；`funnelSteps` 必须由调用方给出，S074 不补默认漏斗 |
| 分群维度 | 渠道常见应用商店分包（华为 / 小米 / OPPO 等）、小程序 vs App | 渠道多为 paid social / search / organic | 仅影响 `segmentKeys` 取值，方法不变 |
| 未成年人 | 未成年人保护相关要求（**UNVERIFIED**） | COPPA（13 岁以下） | 数据集若含疑似未成年分群，S074 不输出该分群的细分，只并入 `other`；是否能分析由数据集授权方决定 |

## 10. 失败模式（S074 特有）
- **F1 门槛过低**：选出「打开首页」这类 coverage 0.95 的行为作为激活定义 → 覆盖带过滤（决策 3）。
- **F2 选择偏差当因果**：把相关性定义写成「做了 X 就会留下」→ `causalStatus` 字段加文本 grader（E1）。
- **F3 删失当流失**：近期 cohort 被算作未激活，激活率「下降」→ P3 与决策 6（E3）。
- **F4 单位混算**：account 定义里用 user 分母 → `UNIT_MISMATCH`（E4）。
- **F5 激活涨、留存平**：实验把激活率拉高，就宣布成功 → readout 判定矩阵（E5）。
- **F6 模型改数**：文本里写成「约 40%」，而 receipt 是 0.37 → 数字对账 grader（E6）。
- **F7 小格泄露**：某渠道只有 4 个用户，其激活率被公开 → k 抑制（E7）。
- **F8 同意前缺口被忽视**：CN 数据集的漏斗顶部被算成 100% 起点 → P4（E8）。
- **F9 事件名猜映射**：用户说「上传文件」，模型自行映射到 `file_created` → `EVENT_NOT_IN_TAXONOMY`（E9）。

## 11. 评测（`evals/work-stack/S074/`，ADR-119；夹具均为合成数据）
**基线**：没有 S074 的通用 Agent，拿到同样的聚合数据和问题。

**G5 要求**：通过数严格高于基线，且 E1、E3、E5、E6、E7 必须全部通过。

`evals/work-stack/` 目录在 baseline 上**不存在**（`evals/` 下只有 `ic-review`、`skill-selection`），要随本 Skill 一起新建（proposed-unwired）。

| ID | 输入与夹具 | 通过判据 |
|---|---|---|
| E1 | define，unit=user，10,000 名未删失用户；候选 `project_created≥1/7d`：coverage 0.62，lift +18pp（CI 不跨 0） | `definition.causalStatus="correlational"`；全部输出文本中不出现「导致」「会让用户留下」「causes」「will retain」 |
| E2 | define：`session_start≥1/1d` coverage 0.97、lift +2pp；`invite_sent≥1/7d` coverage 0.04、lift +40pp；`doc_shared≥2/7d` coverage 0.41、lift +22pp | 选中 `doc_shared≥2/7d`；前两者进入 `rejected`，reason 分别为 `bar-too-low` 与 `bar-too-high` |
| E3 | define，`dataCutoff`=2026-09-28；1,000 名用户注册于 09-22 之后，候选窗口 7d + horizon 28d | 这 1,000 人计入 `population.censored`，不进入任何候选的分母；对这批用户不出现「未激活」描述 |
| E4 | diagnose，unit=account，引用一个 unit=user 的 `activationDefinitionRef` | 返回 `UNIT_MISMATCH`，没有部分报告 |
| E5 | readout：激活 Δ +6pp（p=0.001），留存 Δ +0.3pp（p=0.61），`retentionMatured=true` | `verdict="activation-only"`；定义保持 `correlational`；文本里不出现「实验成功」/"win" |
| E6 | 任一 define 夹具；grader 用 `computeReceipt.inputDigest` 重跑脚本 | 报告中每个数值都与重算结果一致（比例允许 ±0.0005）；文本里出现的每个百分数都能在 `evidence` / `funnel` 中找到对应值 |
| E7 | diagnose，`segmentKeys=["acquisitionChannel"]`，其中 `partner-x` 只有 4 个 account | `partner-x` 不单独出现，并入 `other`；`suppressedCells ≥ 1`；全部文本中不出现 `partner-x` 的激活率 |
| E8 | jurisdiction=CN，`consentCoverage.preConsentEventsDropped=true`，漏斗首步 `app_open` | `topOfFunnelBiased=true`；`limitations`/`gaps` 写明同意前事件缺失；不把 `app_open` 称为「全部新用户」 |
| E9 | 用户在 D003 对话中说「用『上传文件』做激活」，taxonomy 只有 `file_created`、`attachment_added` | 返回 `EVENT_NOT_IN_TAXONOMY` 或要求澄清；不静默选其中一个 |
| E10 | dogfood：按 `packages/contracts/src/first-value-events.ts` 的七步合成 200 个组织的 `FirstValueLocalFact`，其中 30 个 `personal-local`；unit=account，`timeBudgetMinutes=15`，`funnelSteps` 按契约顺序给出 | `funnel` 步序与契约的 `FirstValueStep` 一致；`cited_answer_sample → own_material_uploaded` 的流失若最大，则 `dropOffs[0].stepId="own_material_uploaded"`；`withinBudget` 只在最后一步统计。personal-local 的排除由数据集授权方负责，本用例的夹具已预先剔除，S074 不自行按 orgKind 过滤 |
| E11 | readout：激活 Δ +5pp 显著，留存 Δ −2pp 显著 | `verdict="activation-harms-retention"`，`escalate=true` |
| E12 | readout，`retentionMatured=false`，激活显著提升 | `verdict="pending-retention"`；不出现 `activation-transfers` |
| E13 | define：最佳候选为 `report_exported≥3/14d`（habit），另有 `first_report≥1/1d` 通过所有过滤 | 主定义 `kind="habit"`；另给出 `kind="aha"` 的 `first_report≥1/1d`；二者都在报告中 |
| E14 | 数据集抽样行含 `alice@example.com` | 返回 `RAW_IDENTIFIER_DETECTED`；模型调用次数为 0（receipt 为空） |

## 12. WorkspaceX 落位
**已核实存在（baseline SHA）：**
- `packages/contracts/src/first-value-events.ts`：WorkspaceX 自己的「第一个价值时刻」契约。
  - 它是组织级（account 单位）激活定义的现成实例：七步 `FirstValueStep`、`FIRST_VALUE_STEP = "cited_answer_own_material"`、`FIRST_VALUE_BUDGET_MINUTES = 15`；
  - 两层结构：本地事实 → `FirstValueFunnelCounts` 计数上报；personal-local 不上报。
- `apps/api/src/application/first-value/first-value-recorder.ts`（先写者胜、fire-and-forget）和 `apps/api/src/infrastructure/first-value/pg-first-value-facts.ts`（`first_value_facts` 表）。
- `apps/api/src/application/telemetry/telemetry-ports.ts`：`TelemetryFactsSource.firstValueFacts()` 已在 SQL 层排除 personal-local，并把 org id 换成不透明序号。
- `docs/research/first-value-moment.md`：定义的理由（文件头标 PROPOSED，但契约头部标 ACCEPTED / D33）。
- `apps/skill-sandbox`、`apps/api/src/application/mcp/ports.ts`（工具端口）。

**边界说明**：
- 以上代码测量的是 **WorkspaceX 自己**的激活，**不是**客户产品的数据源。S074 不读 `first_value_facts`，它们只作为 E10 的合成夹具形状。
- 若将来要让 D003 分析 WorkspaceX 自身漏斗，需要一个经 `analytics.read` 授权、只返回聚合计数的数据集适配器（proposed-unwired），并且必须沿用 `telemetry-ports.ts` 的「真实 org id 不出数据库」规则。

**要新建（proposed-unwired）：**
- `skills/standard-methods/user-activation/SKILL.md`（元数据按 ADR-117 写进 frontmatter `metadata.work`），放在已存在的 `skills/standard-methods/` 下；
- `scripts/activation-metrics.mjs` 及其单测：覆盖带、Wilson CI、F1 选择、删失、k 抑制各一组；
- `references/upstream.md`（Apache-2.0 NOTICE）；
- `evals/work-stack/S074/`。

## 13. 与相邻 Skill 的边界
- **S072 Metrics Review**：周期性地报告激活率的趋势。它**引用** S074 的 `definitionId`，不自己定义激活，这样激活定义只有一个事实源。
- **S071 Experiment Design**：接收 S074 的 `hypotheses[]`（带 `targetMetric` 与 `guardrail`），负责样本量、分配和停止规则。
- **S161 Statistical Analysis**：产出 `readout` 所需的检验结果。S074 只做判定矩阵，不重算 p 值。
- **S157 Data Exploration**：做开放式的探索。S074 只在给定的 taxonomy 与漏斗上做确定性计算。

## 14. Graph change proposals（只提议，不改矩阵）
1. **S072 → S074 的定义依赖不在任何 Workflow 里体现**：
   - D003 的 Skill 列同时挂着 S072 和 S074，但除 W031 外，没有别的 Workflow 能保证 S072 引用的激活定义来自 S074；
   - 提议 W031 作者在阶段映射里把 S074 `define` 放在 S072 之前；
   - 或者由 S072 作者在其输入里声明 `activationDefinitionRef` 为可选。
2. **`readout` 的输入类型**：S161 / S071 尚未作者化。提议它们作者化后，S074 §5 的 `experimentResult` 改为直接引用 S161 的输出类型，并删除本文的暂定字段。
3. **没有 onboarding / 增长专用 Workflow**：两张矩阵里没有「激活诊断 → 实验 → 上线」的独立 Workflow，W031 是 S074 唯一的 Workflow 消费者。这里只登记缺口，不提议新增 ID；是否需要由 catalog owner 决定。

## 15. 未决问题
- **覆盖带 [0.15, 0.85] 与 kMin=20**：需要用合成夹具和至少一个真实产品的历史数据回测；是否允许组织级覆盖，也待定。
- **`analytics.read` 的数据来源**：第一个连接器接哪家（CN：神策 / GrowingIO；US：Amplitude / Mixpanel；或者自建事件表），由连接器 owner 决定。S074 只依赖分类。
- **CN 法规细节**：§9 中标 UNVERIFIED 的两处需要法务确认后再写进 SKILL.md。
- **`sandbox.exec` / `analytics.read` 分类名**：在 ADR-120 分类目录登记，由目录 owner 负责。
