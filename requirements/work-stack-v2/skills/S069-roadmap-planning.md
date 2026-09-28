# S069 — Roadmap Planning（路线图规划）

> Type: Work Skill · Domain: Product · Strategy: A1（一个主源 adapt + 一个参考源）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文独立作者化（AUTHOR-S069）；v1 模板只用作话题清单，正文未沿用。
> 凡是引用 WorkspaceX 现有代码的地方，都已在 baseline 上读过文件；没有读过的标 **UNVERIFIED**，尚不存在或尚未接线的能力标 **proposed-unwired**。

## 1. 这个 Skill 解决什么问题
S069 把「已经排好优先级的一组举措」加上「团队可用容量」「依赖」「上一版路线图」，编排成一份**分时间视野、带承诺等级、容量对得上账、能与上一版逐项 diff** 的路线图版本 `RoadmapPlan`。

它回答三个问题：
1. 在给定容量下，哪些举措进 Now（承诺）、哪些进 Next（计划）、哪些进 Later（方向），哪些明确 `not-doing`；
2. 每个进入路线图的举措预期推动哪个结果指标，交付后 S155 拿什么对账；
3. 相比上一版改了什么、为什么改、谁受影响。

S069 **不做**的事（各有唯一归属）：
| 不做 | 归谁 |
|---|---|
| 给举措打分排序（RICE / ICE / MoSCoW） | S068 Prioritization。S069 只消费排序结果，不重算分数（决策 1） |
| 竞品态势判断 | S008 Competitive Analysis，S069 只引用其 `implicationId` |
| 指标走势解释 | S072 Metrics Review |
| 已交付项的预期 vs 实际对账 | S155 Business Review（`reviewKind = roadmap-outcome`） |
| 冲刺内的任务拆分与承诺 | S070 Sprint Planning |
| 写 PRD | S067 PRD / Spec Writing |

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（`WORKFLOW-SKILL-MATRIX.md`）
| Workflow | 矩阵行 | 该行 Skill 列 | S069 在其中的职责 |
|---|---|---|---|
| W032 Roadmap Review（Product） | 第 38 行 | S069, S068, S072, S009, S008, S155 | 以 `mode = "revise"` 产出新版 `RoadmapPlan` 与 `changeLog`；S155 的 `roadmap-outcome` 复盘结论、S008 的 implication、S072 的指标结论、S009 的客户证据都只作为 S069 的**引用输入**，S068 的排序作为 S069 的**排序输入** |

矩阵只给 Skill 集合，不给阶段顺序。S069 在 W032 中的阶段位置由 W032 作者决定；S069 的契约只要求 S068 排序结果在它之前可得（缺失时见 §5.4 `RANKING_MISSING`）。

### 2.2 DigitalHuman（`DIGITALHUMAN-COMPOSITION-MATRIX.md`）
| DigitalHuman | 矩阵行 | 该行 Workflow | 该行 Skill 列 | gaps 列 |
|---|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | S061, S009, S064, S065, S067, S068, **S069**, S070, S071, S072, S073, S074, S008, S075 | — |
| D015 Agile / Product Operating Model Coach | 第 21 行 | W030, W032, W053, W002 | S070, S068, **S069**, S142, S153, S143, S156 | Retrospective facilitation; Kanban flow analysis; Product operating model health |

按 ADR-118 决策 9（已读 `docs/adr/ADR-118-generic-workflow-runtime.md` 第 26 行）：D003、D015 行里的 S069 是**聊天直接调用**的挂载；二者运行 W032 时使用的是 W032 固定的 S069 版本，两个版本可以不同。

两个角色的直接调用场景不同，S069 用 `purpose` 字段区分而不是拆成两个 Skill：
- D003：`purpose = "plan"`，产出/修订路线图；
- D015：`purpose = "health-check"`，只跑 §4 的 C、D 两段检查（容量、承诺比例、变更频率），不产出新版本。D015 gaps 列的「Product operating model health」**不由 S069 认领**，见 §13 提议 2。

## 3. 上游来源与许可（G1）
| 仓库 | 路径 | SHA | 许可（artifact 级） | 处理方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `product-management/skills/roadmap-update/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7`（该路径最后一次提交） | Apache-2.0（`product-management/LICENSE`） | **adapt**。采用：Now/Next/Later 三段的置信度含义（:98-105）；五类依赖分类 technical/team/external/knowledge/sequential（:183-189）与「need-by 日期 + 依赖负责人」（:193-194）；容量扣减与 70/20/10 默认分配（:207-218）；「超容量就砍范围，不假设人能多干」「加一项就问拿掉哪一项」（:227-229）；变更沟通五步（:244-248）与防抖动规则（:251-254）。**不采用**：该文件内嵌的 RICE/MoSCoW/ICE 打分段（:137-178），打分归 S068（决策 1）；Gantt 视图对外使用（:127-135 本身也警告）。 |
| RefoundAI/lenny-skills | `skills/roadmap-prioritization/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`） | **reference-only**。只借两点：「固定投入上限（appetite）而非估时」用于 Next 段的 `appetite` 字段；「增量 / 大赌注 / 基础项」组合比例用于 C3 检查。不复制访谈引语。 |

- 上游要点均已中文重述，NOTICE 与改动说明写入 SKILL.md 的 `references/upstream.md`（proposed-unwired）。
- 第二来源只作参考的理由：lenny-skills 这份是原则与提问清单，没有可执行步骤或输出结构。

## 4. 专业方法（S069 专属步骤）
### A. 读入与对齐
- **A1 周期与视野。** 由 `horizonConfig` 确定 Now/Next/Later 的时间边界（默认 Now = 当前季度，Next = 下一季度，Later = 其后 2 个季度）。Now 与 Next 允许 `targetWindow`（季度或月），Later **只能**写 `horizon = "later"`，不许带日期（决策 3）。
- **A2 结果锚。** 每个举措必须挂到 `outcomes[]` 中的一个结果（OKR 的 KR 或产品北极星子指标，带 `metricRef`）。挂不上的举措不进入 Now/Next，只能进 Later 并标 `outcomeLink = "unanchored"`，或进 `notDoing`。
- **A3 排序只读。** 读 S068 的排序（`rankingRef`）。S069 不改排序值；若为容量或依赖原因越过排序（低排名进 Now、高排名被推后），必须写 `rankOverride{reason ∈ capacity | dependency | hard-deadline | appetite}`。

### B. 依赖编排
- **B1 依赖建图。** 每条依赖记 `type ∈ technical | team | external | knowledge | sequential`、`ownerPrincipalId`、`needBy`。
- **B2 环检测。** 对依赖图做拓扑排序；存在环返回 `DEPENDENCY_CYCLE` 并列出环上 itemId，不输出计划。
- **B3 视野一致性。** 被依赖项的视野不得晚于依赖方（Next 项依赖 Later 项 → 违规）。违规项自动降一个视野并记入 `adjustments[]`，不静默。
- **B4 跨团队依赖。** `type = team | external` 且依赖方在 Now 的，若 `dependencyAcknowledged != true` 则该项 `commitment` 降为 `planned`（决策 4）。

### C. 容量对账
- **C1 净容量。** `netCapacity = Σ(人数 × 周期工作日) − 假期 − 已知开销`，再乘 `plannedWorkRatio`（默认 0.65，取上游 60–70% 中值）。节假日表按 `calendar`（§9）。
- **C2 分配。** 按 `allocation`（默认 feature 0.70 / health 0.20 / buffer 0.10）切分；`buffer` 不得分配给任何举措。
- **C3 装填。** 按排序（含 override）把 Now 项装入 feature 与 health 桶；装不下的项**不许**扩大容量，只能：降入 Next、缩小范围（写 `scopeCut`）、或进 `notDoing`。Now 装填率 `nowLoad = ΣNow估算 / (feature+health)` 必须 ≤ 1.0；> 0.9 时给 `warn: tight`。
- **C4 组合比例。** 统计 Now+Next 中 `bet | incremental | foundation` 的占比；任一类为 0 时给出观察（不阻断）。

### D. 版本对比与防抖动
- **D1 diff。** 与 `previousPlanRef` 逐项比较，产出 `changeLog[]`：`added | removed | horizon-moved | commitment-changed | scope-cut | target-window-moved`。
- **D2 变更原因。** 每条变更必须有 `trigger ∈ strategy | evidence | estimate | dependency-slip | capacity-change | competitive | outcome-review` 和 `evidenceRefs[]`（可指 S155 复盘、S008 implication、S072 结论、S009 证据）。无证据的变更 `trigger` 只能是 `strategy`，且需 `decidedBy` 为人。
- **D3 抖动阈值。** 统计本版对上一版 Now 段承诺项的变动率 `churnNow`；> 0.3 时输出 `whiplashFlag`，D015 `health-check` 会把连续两版 flag 作为观察项上报。
- **D4 受影响方。** 被移出 Now 或推后的承诺项，列出 `affectedStakeholders[]`（来自该项 `requestedBy`），供后续沟通；S069 不发送任何消息。

### E. 视图派生
- **E1** 输出一份权威 `RoadmapPlan`，加上从它派生的 `views[]`：`internal-detailed`（全字段）与 `external-safe`（只含 Now/Next 的 theme 与标题，不含 `targetWindow` 细节、成本、竞品引用、未公告项；附固定免责声明）。外部视图只是投影，不是第二份事实源（决策 5）。

## 5. 输入 / 输出契约（写入 `metadata.work.inputSchema/outputSchema`，ADR-117；`WorkSkillManifest` 本身 proposed-unwired）
### 5.1 输入 `RoadmapPlanningInput`
```ts
RoadmapPlanningInput = {
  purpose: "plan" | "health-check";
  mode: "create" | "revise";                        // revise 必须带 previousPlanRef
  productScopeId: string;                           // 产品线/团队范围
  previousPlanRef?: { skill: "S069"; planId: string; version: number };
  horizonConfig?: { nowEnd: string; nextEnd: string; laterEnd: string };  // ISO 日期，严格递增
  calendar: "CN-mainland" | "US-federal" | "custom";
  outcomes: Array<{ outcomeId: string; statement: string; metricRef: string; targetValue?: number }>;  // 1–10
  initiatives: Array<{
    initiativeId: string; title: string;            // ≤60 字
    kind: "bet" | "incremental" | "foundation";
    bucket: "feature" | "health";
    estimate: { personWeeks: number; confidence: "high" | "medium" | "low" } | { appetiteWeeks: number };
    outcomeId?: string; requestedBy?: string[];     // principalId
    hardDeadline?: { date: string; source: "contract" | "regulation" | "launch-event" };
    announced?: boolean;                            // 是否已对外公告
  }>;                                               // 1–80
  rankingRef?: { skill: "S068"; rankingId: string };  // purpose=plan 时必填
  dependencies?: Array<{ from: string; to: string; type: DepType; ownerPrincipalId?: string; needBy?: string; dependencyAcknowledged?: boolean }>;
  capacity: { teams: Array<{ teamId: string; headcount: number; knownOverheadDays?: number; ptoDays?: number }>;
              plannedWorkRatio?: number;            // 0.4–0.9，默认 0.65
              allocation?: { feature: number; health: number; buffer: number } };  // 和=1，buffer ≥ 0.05
  evidenceRefs?: Array<{ skill: "S155" | "S008" | "S072" | "S009"; artifactId: string; itemId?: string }>;
  locale: "zh-CN" | "en-US";
}
```

### 5.2 输出 `RoadmapPlan`
```ts
RoadmapPlan = {
  planId: string; version: number;                  // revise 时 = previous.version + 1
  productScopeId: string; asOf: string; calendar: Calendar;
  horizons: { now: Window; next: Window; later: { start: string } };   // later 无 end 展示
  capacityLedger: {
    netCapacityPersonWeeks: number; plannedWorkRatio: number;
    buckets: { feature: number; health: number; buffer: number };      // 人周
    nowLoad: number; loadWarning?: "tight";
    mix: { bet: number; incremental: number; foundation: number };    // Now+Next 占比
  };
  items: Array<{
    itemId: string; initiativeId: string; title: string; themeOutcomeId: string | null;
    horizon: "now" | "next" | "later";
    commitment: "committed" | "planned" | "directional";   // 与 horizon 默认对应，可降不可升
    targetWindow?: string;                          // 仅 now/next，形如 "2026-Q4" 或 "2026-11"
    outcomeLink: "anchored" | "unanchored";
    expectedOutcome?: {                            // 字段与 S155 §5.1 commitments[] 对齐
      metricRef: string; definitionVersion: string;  // 指标口径版本，S155 据此判 comparable
      direction: "up" | "down";                  // 映射为 S155 polarity
      targetValue: number; targetSetAt: string;  // 目标值与设定时刻（ISO），S155 必需
      reviewAfter: string;                       // 最早复盘日，决定进入哪个 S155 period
    };
    rank: number | null; rankOverride?: { reason: "capacity" | "dependency" | "hard-deadline" | "appetite"; note: string };
    scopeCut?: string; appetiteWeeks?: number;
    dependsOn: string[]; evidenceRefs: EvidenceRef[];
  }>;
  notDoing: Array<{ initiativeId: string; reason: "capacity" | "unanchored" | "evidence-against" | "strategy"; note: string }>;
  adjustments: Array<{ itemId: string; rule: "B3" | "B4" | "C3"; from: string; to: string }>;
  changeLog: Array<{ itemId: string; change: ChangeKind; trigger: Trigger; evidenceRefs: EvidenceRef[];
                     decidedBy?: string; affectedStakeholders: string[] }>;   // create 模式为空
  churnNow: number | null; whiplashFlag: boolean;
  healthObservations: Array<{ code: "NO_BETS" | "NO_FOUNDATION" | "OVERLOAD" | "WHIPLASH" | "UNANCHORED_SHARE"; detail: string }>;
  views: Array<{ audience: "internal-detailed" | "external-safe"; itemIds: string[]; disclaimer?: string }>;
  status: "draft";                                  // S069 从不产出 approved，批准是 W032 人工门
}
```
`purpose = "health-check"` 时只返回 `capacityLedger`、`churnNow`、`whiplashFlag`、`healthObservations`，其余字段省略。

### 5.3 不变量（输出前机检，`scripts/check-plan.mjs`，proposed-unwired）
1. `horizon = later` ⇒ 无 `targetWindow`、`commitment = directional`。
2. `commitment = committed` ⇒ `horizon = now` 且 `outcomeLink = anchored` 且 `expectedOutcome` 存在，且其 `metricRef`、`definitionVersion`、`targetValue`、`targetSetAt` 均非空（S155 §4 步骤 1 的必需字段）。
3. `capacityLedger.nowLoad ≤ 1.0`；`buffer` 桶未被任何 item 占用。
4. 依赖图无环；任何 item 的 `dependsOn` 项视野不晚于它自己。
5. 有 `hardDeadline` 的举措要么在对应视野内，要么在 `notDoing`/降级项中且 `changeLog` 或 `adjustments` 显式记录冲突，不允许静默错过。
6. `rank` 与 S068 排序逐项一致；次序违反排序的 item 必有 `rankOverride`。
7. `external-safe` 视图不含 `announced = false` 的项、不含 `evidenceRefs` 指向 S008 的内容。
8. 每条 `changeLog` 有 `trigger`；`evidenceRefs = []` ⇒ `trigger = strategy` 且 `decidedBy` 为人类 principal。
9. 输出中无打分字段（`score`、`rice`、`ice`）。

### 5.4 错误包络（typed errors）
| code | 触发 |
|---|---|
| `PREVIOUS_PLAN_REQUIRED` | `mode = revise` 无 `previousPlanRef` |
| `PREVIOUS_PLAN_NOT_FOUND` | 服务端按调用者组织读不到该版本（含跨组织） |
| `RANKING_MISSING` | `purpose = plan` 无 `rankingRef`，或引用的排序不含全部 `initiativeId` |
| `RANKING_NOT_FOUND` | 服务端按调用者组织读不到 `rankingRef` 指向的排序（含跨组织；不区分「不存在」与「无权」，避免泄露存在性） |
| `DEPENDENCY_CYCLE` | B2 检出环，附 `cycle: string[]` |
| `HORIZON_CONFIG_INVALID` | 日期不递增或 Now 已过期 |
| `CAPACITY_INVALID` | allocation 和 ≠ 1、buffer < 0.05、headcount ≤ 0 |
| `EVIDENCE_REF_UNREADABLE` | 某 `evidenceRefs` 服务端无读权限；该引用被丢弃并列入 `inputDigest`，不整体失败 |
| `INVARIANT_VIOLATION` | §5.3 任一条在自修复后仍不成立，附条号 |

## 6. 授权边界：调用方声明 vs 服务端核验
| 项 | 调用方可声明 | 服务端必须核验 |
|---|---|---|
| 能否调用 S069 | — | 直接调用：当前 Agent 已发布版本在 `agent_versions.skill_version_ids` 中固定了 S069（字段注释已核实于 `packages/contracts/src/identity.ts:363,431`；pin 写入路径 `apps/api/src/application/agent-skill-pins/set-agent-skill-pins.ts` 已核实存在）。运行时调用前按 pin 拦截的代码位置 **UNVERIFIED**。W032 内：按 W032 固定的版本，不看 Agent 挂载（ADR-118 决策 9）。 |
| `previousPlanRef` / `rankingRef` / `evidenceRefs` | 给 id | 按调用者身份与组织读取对应版本；**不接受**调用方内联的上一版正文或排序值。 |
| `capacity.headcount` | 可声明 | 不核实真伪（无 HR 数据接线，**proposed-unwired**）；输出 `capacityLedger` 标 `source = "caller-declared"`，W032 人工门时展示。 |
| `decidedBy` | 不可声明 | 取自会话认证主体；Agent 自身不能成为 `decidedBy`。 |
| `status` | 不可声明 | 恒为 `draft`；转 `approved` 只能经 W032 的人工门（W032 文档未作者化，门的形态 **UNVERIFIED**）。 |
| `announced` | 可声明 | 不核实；为 false 时一律不进外部视图，错报只会让外部视图变少。 |

## 7. 依赖（能力分类，ADR-120）
- **required**：无外部写。纯编排推理。
- **conditional**：`knowledge.read`，读取 previousPlan / S068 ranking / evidenceRefs 版本。分类名是否已在 ADR-120 目录登记：**UNVERIFIED**。
- **optional**：`sandbox.exec` 运行 `scripts/check-plan.mjs`（拓扑排序、容量账、不变量）。`apps/skill-sandbox/` 目录已存在（已核实）；脚本 proposed-unwired。
- 写回项目工具（Jira/Linear 的 roadmap 字段、WorkspaceX 工作项）**不在** S069 内；需要时由 W032 另一阶段以 high-impact 写入实现。riskClass = low。

## 8. CN / US 差异（仅列会改变输出的）
- **节假日与净容量。** `calendar = CN-mainland` 使用国务院年度放假安排，含调休补班日（补班日计入工作日）；春节、国庆两个长假所在季度的净容量通常明显下降，C1 必须按具体日期扣减，不按固定比例。`US-federal` 用联邦假日，另提示 11–12 月 PTO 集中。节假日数据源本身 **proposed-unwired**（需要按年更新的表，归属未定）。
- **硬截止来源。** CN 常见 `hardDeadline.source = regulation` 的例子：算法推荐备案、个人信息出境评估、等保测评周期；US 常见：SOC 2 审计窗口、州隐私法生效日。S069 只按日期排程，不判断合规义务是否存在。
- **季度边界。** 两地都默认自然季度；财年不同（如 US 公司财年 2 月起）时通过 `horizonConfig` 显式给出，S069 不猜财年。
- **外部视图措辞。** zh-CN 免责声明「以下为方向性规划，不构成交付承诺」；en-US 使用 forward-looking 声明句式。两者都不带具体日期。

## 9. 决策
- **决策 1：S069 不打分，只消费 S068 的排序，偏离必须写原因。** 上游 roadmap-update 把 RICE/ICE 内嵌在路线图技能里，导致同一举措可能在两处被打出不同分数——正是 AGENTS.md「同一事实不得声明在两处」的问题。S069 的专业价值在于容量、依赖、视野的编排，偏离排序是合法的，但必须可审计（`rankOverride`，不变量 6）。
- **决策 2：超容量只能砍、降、推，不能加容量。** 采用上游 :227-229 的原则并做成硬不变量（`nowLoad ≤ 1.0`，buffer 不可占用）。调用方若想加人，应修改 `capacity` 输入重跑，由人对该输入负责，而不是让模型「挤一挤」。
- **决策 3：Later 段禁止日期，承诺等级只降不升。** 避免上游警告的「虚假精确」。`committed` 只存在于 Now 且必须带可对账的 `expectedOutcome`，使 S155 的 `roadmap-outcome` 复盘有明确对象（与已 PASS 的 S155 §5.1 `commitments[].kind = "roadmap-outcome"` 对接，`expectedOutcome` 按 S155 定稿字段携带 `metricRef + definitionVersion + targetValue + targetSetAt`，映射规则见 §12）。
- **决策 4：未确认的跨团队依赖使承诺降级。** 路线图最常见的失约来源是别的团队不知道自己被依赖。`dependencyAcknowledged` 由调用方提供，S069 不去问对方团队，但未确认时不许标 `committed`。
- **决策 5：外部视图是投影，不是第二份路线图。** 只有 `RoadmapPlan` 是权威；`external-safe` 按 itemId 投影并受不变量 7 约束，防止未公告项或竞品判断外泄（S008 的产物 `audience` 恒为 `internal-only`）。
- **决策 6：抖动是可计算的健康信号。** 采用上游 :251-254「跟踪路线图变更频率」，定义为 `churnNow`；这使 D015 的 `health-check` 可以只调用 S069 而不另起一套口径。

## 10. 失败模式（S069 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 功能清单冒充路线图：每项都没有结果锚 | `UNANCHORED_SHARE` > 0.3 | 未锚项不许进 Now/Next（A2），输出观察 |
| F2 | Later 带日期制造虚假承诺 | 不变量 1 | schema 拒绝 |
| F3 | 超载规划：Now 装填 130% | 不变量 3 | C3 降级/砍范围，列入 `adjustments` |
| F4 | 依赖倒挂：Now 项依赖 Later 项 | B3 / 不变量 4 | 依赖方降视野并记录 |
| F5 | 偷偷重排：模型按自己偏好改变次序 | 不变量 6 | 无 override 即 `INVARIANT_VIOLATION` |
| F6 | 静默删项：上一版承诺项在新版消失 | D1 diff 中出现无 `changeLog` 的缺失 | 强制生成 `removed` 条目并列出受影响方 |
| F7 | 硬截止被错过 | 不变量 5 | 显式冲突记录，不能静默 |
| F8 | 外部视图泄露未公告项或竞品判断 | 不变量 7 | 视图生成时剔除 |
| F9 | 路线图抖动：每周大改 | `churnNow > 0.3` | `whiplashFlag`，不阻断 |

## 11. 评测（`evals/work-stack/S069/`，ADR-119；夹具为合成数据，proposed-unwired）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | 2 个团队共 8 人，Now 候选合计 90 人周，净容量折算 feature+health 为 60 人周 | `nowLoad ≤ 1.0`；超出部分进 Next/notDoing 或有 `scopeCut`；buffer 桶占用为 0 |
| E2 | 依赖 A→B→C→A | 返回 `DEPENDENCY_CYCLE`，`cycle` 含 A、B、C；无 `items` 输出 |
| E3 | S068 排名第 5 的项有 `hardDeadline(regulation)` 在 Now 内，排名 1–4 已装满 | 第 5 项进 Now 且 `rankOverride.reason = hard-deadline`；被挤出的项有 `adjustments` 记录 |
| E4 | revise：上一版 Now 有 5 个 committed 项，新输入删掉其中 2 个，无 evidenceRefs | 2 条 `removed`，`trigger = strategy`，`decidedBy` 为会话用户；`churnNow = 0.4`，`whiplashFlag = true`；`affectedStakeholders` 等于这些项的 `requestedBy` |
| E5 | 某 Now 项依赖外部团队，`dependencyAcknowledged = false` | 该项 `commitment = planned`，`adjustments` 中 rule = B4 |
| E6 | 3 个举措没有 `outcomeId` | 它们只出现在 Later（`unanchored`）或 notDoing；`healthObservations` 含 `UNANCHORED_SHARE` |
| E7 | evidenceRefs 含 S155 `roadmap-outcome` 复盘：上季度 committed 项「审批提醒」实际指标未动 | 若本版把该方向的后续项下调，`changeLog.trigger = outcome-review` 且引用该复盘 id；若保留，项上不得写成「已验证有效」 |
| E8 | 一项 `announced = false`，另一项引用 S008 `parity-gap` implication | `external-safe` 视图中两项都不出现；视图无 `targetWindow`，带免责声明 |
| E9 | `calendar = CN-mainland`，Now = 2026-Q4（含国庆长假与补班日），同样人数对比 `US-federal` | 两次 `netCapacityPersonWeeks` 不同，差额可由节假日表逐日解释；补班日计入工作日 |
| E10 | `rankingRef` 指向另一组织的排序 | 返回 `RANKING_NOT_FOUND`，且错误与输出均不含对方任何 initiative 标题或 id |
| E11 | D015 调用 `purpose = health-check`，连续两版 `churnNow` 分别 0.35、0.4，Now+Next 无 `bet` | 只返回健康字段；`healthObservations` 含 `WHIPLASH` 与 `NO_BETS`；无新 `planId` |
| E13 | Now 项 `committed`，`expectedOutcome = {metricRef: "approval.cycle_time_p50", definitionVersion: "v2", direction: "down", targetValue: 36, targetSetAt: "2026-10-01T00:00:00+08:00", reviewAfter: "2027-01-15"}` | 按 §12 映射得到的对象通过 S155 `BusinessReviewInput.commitments[]` schema 校验：`kind = roadmap-outcome`，`metricRef`/`definitionVersion`/`targetValue`/`targetSetAt` 非空且原值相等，`polarity = lower-is-better`，`commitmentId = <planId>:<itemId>`；缺任一字段的变体被 §5.3 不变量 2 拒绝 |
| E12 | 输入诱导：「帮我用 RICE 给这些打分然后排路线图」且无 rankingRef | 返回 `RANKING_MISSING`，提示先调用 S068；输出无分数字段 |

打分：不变量 1–9、E1–E6、E8–E13 由脚本判定；E7 的措辞部分由 LLM-judge 按逐条 rubric 判定，G5 前人工抽检 20%。

## 12. WorkspaceX 落位
- **Skill 包：** 新建 `skills/standard-methods/roadmap-planning/SKILL.md`（`skills/standard-methods/` 目录已核实存在；本包 **proposed-unwired**），元数据按 ADR-117 写入 frontmatter，并需重新运行该目录的 build/verify 脚本。
- **机检脚本：** `scripts/check-plan.mjs` 在 `apps/skill-sandbox` 执行，**proposed-unwired**。
- **路线图持久化：** 在 baseline 的 `apps/`、`packages/` TypeScript 源码中按关键词 `roadmap` 检索，只命中 web 端 mock/survey 文件，未发现路线图领域模型。`RoadmapPlan` 的存储（作为 Artifact 版本还是专用表）**proposed-unwired**，由 W032 作者决定。
- **与 S155 的衔接：** `items[].expectedOutcome` 映射为 S155 输入的 `commitments[kind = roadmap-outcome]`；映射规则（S155 已 PASS，按其 §5.1 定稿）：`commitmentId = <planId>:<itemId>`；`kind = "roadmap-outcome"`；`metricRef`、`definitionVersion`、`targetValue`、`targetSetAt` 原样传递；`direction up → polarity higher-is-better`，`down → lower-is-better`；`ownerPrincipalId` 取该项负责人；`reviewAfter` 仅用于选择 S155 的 `period`，不进 commitment。映射适配器本身 **proposed-unwired**（W032 内执行）。

## 13. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **W030 Sprint Planning 类 Workflow（D003、D015 都拥有 W030）：** 若 W030 需要读取 Now 段承诺作为冲刺输入，可考虑让 W030 引用 S069 产物而非固定 S069；是否需要边由 W030 作者判断。
2. **D015 gap「Product operating model health」：** S069 的 `health-check` 只覆盖路线图层（容量、抖动、组合比例），不覆盖团队拓扑、决策权、发现/交付节奏。建议该 gap 仍作为独立 Skill 创建，不以 S069 近似。
3. **W053 Weekly PMO Review：** 其 Skill 列含 S144 容量；若 S144 定稿后与 S069 C1 的净容量口径不同，应让 S069 引用 S144 的容量产物而不是自算，避免两个容量事实源。

## 14. 未决问题
- W032 的阶段顺序与人工门形态未作者化（UNVERIFIED），S069 的 `status = draft` 转 `approved` 依赖它。
- S068 排序产物字段未定稿，`rankingRef` 的解析适配待 S068 PASS 后补齐。
- CN/US 节假日表的数据源与年度更新责任未定。
- `knowledge.read`、`sandbox.exec` 是否已在 ADR-120 目录登记（UNVERIFIED）。
