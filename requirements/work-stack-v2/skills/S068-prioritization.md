# S068 — Prioritization（优先级排序）

> Type: Work Skill · Domain: Product · Strategy: A1（一个主源 adapt + 一个参考源）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文独立作者化（AUTHOR-S068）；v1 模板未沿用任何正文。
> 引用 WorkspaceX 现有代码处均已在 baseline 上读过文件；未读过的标 **UNVERIFIED**，不存在或未接线的能力标 **proposed-unwired**。

## 1. 这个 Skill 解决什么问题
S068 接收一组**已经存在、彼此可比**的候选项（解法、PRD 需求条目、路线图条目），在给定的**投入上限**（appetite / 容量）之内，产出一份**带理由、带稳定性说明的排序提议** `PrioritizationProposal`。它回答三个问题：
1. 在这批候选里，谁排在前面，依据的是哪个框架、哪些输入数字、这些数字从哪来；
2. 排序有多稳：输入估计变动一档，前几名会不会换位；
3. 在投入上限内，哪些进、哪些明确不进（Won't），以及为了放进新东西挤掉了什么。

S068 输出的是**提议**，不是决定。把排序写成路线图、写成冲刺承诺、写成卡片，都不在这里。

| 不做 | 归谁 |
|---|---|
| 生成候选解法 / 机会树 / 机会层比较 | S066 Product Brainstorming / S065 Opportunity Mapping |
| 写 PRD 条目本身 | S067 PRD / Spec Writing |
| Now / Next / Later 时间编排与路线图文档 | S069 Roadmap Planning |
| 冲刺容量计算与冲刺目标 | S070 |
| 在看板上建卡、改卡 | S142 Work Item Management |
| 指标定义与度量 | S162 / S072 |

S068 专属的风险有两类：**虚假精度**（拍脑袋的 Reach / Effort 相乘得出小数点后两位的分数，被当成事实）和**无痕改序**（路线图评审里顺序变了，说不出是什么新信息导致的）。§4 的方法与 §6 的不变式就是守这两点。

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行 | 该行 Skill 列（原样） | S068 在本 Workflow 中承担的模式（§4.0） |
|---|---|---|---|
| W029 Problem-to-PRD | 第 35 行 | S064, S065, S067, S068, S162 | `solution-select` |
| W030 PRD-to-Sprint | 第 36 行 | S067, S068, S070, S142, S076 | `scope-cut` |
| W032 Roadmap Review | 第 38 行 | S069, S068, S072, S009, S008, S155 | `rerank` |

阶段顺序由各 Workflow 文档决定；上表「模式」列是 S068 对这三种输入形态的约定，不是对 Workflow 阶段图的声明。按 ADR-118 决策 9（已读 `docs/adr/ADR-118-generic-workflow-runtime.md:26`），这三个 Workflow 固定 S068 的版本，负责它们的 Agent 不因此需要另外挂载 S068。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
| DigitalHuman | 矩阵行 | 该行 Workflow | 该行 Skill 列（原样） | gaps 列 |
|---|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | S061, S009, S064, S065, S067, **S068**, S069, S070, S071, S072, S073, S074, S008, S075 | — |
| D015 Agile / Product Operating Model Coach | 第 21 行 | W030, W032, W053, W002 | S070, **S068**, S069, S142, S153, S143, S156 | Retrospective facilitation; Kanban flow analysis; Product operating model health |

按 ADR-118 决策 9，DigitalHuman 行的 Skill 列只代表**聊天中直接调用**。D003 与 D015 直接调用时模式为 `direct`（§4.0）。D015 的 gaps 列三项都不是排序能力，S068 不认领。

## 3. 上游来源与许可（G1）
| 仓库 | 路径 | SHA | 许可（artifact 级） | 处理方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/knowledge-work-plugins`） | `product-management/skills/roadmap-update/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7`（该路径最后一次提交） | Apache-2.0（`product-management/LICENSE`） | **adapt**。采用：RICE 的四个因子定义与 Impact 五档（0.25/0.5/1/2/3）、Confidence 三档（100/80/50）（:139–147）；MoSCoW 四档及「Won't 必须写出来」（:149–157）；ICE 1–10 三因子（:159–168）；各框架的适用场景说明（:147、:157、:168）；改序要回答「什么变了」（:263）与「展示取舍：为腾位挤掉了什么」（:246）。**不采用**：Value vs Effort 2×2（:170–178）作为输出形态——四象限在象限边界附近不稳定且不可审计，S068 只把它作为 `direct` 模式下的展示视图；「Money pits: Remove from the backlog」（:176）——删除 backlog 条目是 S142 的写动作，S068 只能标 `wont`。 |
| RefoundAI/lenny-skills（本地克隆 `scratchpad/upstream/lenny-skills`） | `skills/roadmap-prioritization/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`，Copyright (c) 2025 Refound AI） | **reference-only**。借用两点并用中文重述：固定 appetite 优先于逐项估时（:36–39）→ 用于 `scope-cut` 模式；增量 / 大赌注 / 基础保障三类的组合平衡（:16）→ 用于 B6 组合检查。播客嘉宾引语一律不复制。 |

- 按 Apache-2.0 §4(b)(c)，改动说明与 NOTICE 放在 SKILL.md 的 `references/upstream.md`；本文所列上游要点均已中文重述，未复制段落。
- 第二来源只作参考的原因：lenny-skills 该文件是观点汇编，没有可执行的打分定义；可执行的框架定义只在 roadmap-update 中找到。

## 4. 专业方法（S068 专属步骤）
### 4.0 模式
| 模式 | 典型调用方 | 候选项来源 | 目标 |
|---|---|---|---|
| `solution-select` | W029 | S065 `handoff.S068.solutionIds`（S065 文档尚未 PASS，字段名以其定稿为准）或调用方列出的解法 | 选出进入 PRD 的解法，最多 1 个 `selected` + 备选 |
| `scope-cut` | W030 | S067 的需求条目 id | 在 appetite 内给出 MoSCoW 切分 |
| `rerank` | W032 | 上一版 `PrioritizationProposal` + 新信息 | 在上一版基础上改序，并说明每处改动的原因 |
| `direct` | D003 / D015 聊天 | 用户粘贴或引用的清单 | 任一框架，产物同一结构 |

### A. 候选准入
- **A1 可比性检查。** 同一次排序里的候选必须同一粒度（都是解法，或都是需求条目，或都是路线图条目）。检测：`candidates[].kind` 不一致 → `MIXED_GRANULARITY`。一个「重做计费系统」和一个「改按钮文案」混排时，任何框架的结果都没有意义。
- **A2 硬钉住项分离。** 有**外部截止日**（法规生效、合同交付日、证书到期）或**已签承诺**的候选，不参与打分，进入 `pinned[]`，写明 `pinReason` 与 `deadline`，并先扣除它们占用的投入。原因：这类条目的延期成本是阶跃的，放进 RICE 只会被低 Reach 拉到底部。钉住需要证据引用（§8：调用方声明，服务端核实引用可读）。
- **A3 依赖展开。** 读 `dependsOn`。若 A 依赖 B，则 B 的名次不能低于 A；排序结果违反时，把 B 提到 A 之前并记 `dependencyLift`。依赖成环 → `DEPENDENCY_CYCLE`。

### B. 打分与排序
- **B1 选框架（不由模型自由选）。** 规则：
  - 能为 ≥80% 候选给出**带来源**的 Reach 绝对数（来源为指标查询、合同客户数、日志计数）→ `RICE`；
  - 否则 → `ICE`，且输出中禁止出现「覆盖用户数」类表述；
  - `scope-cut` 模式固定 `MoSCoW`，内部仍用 RICE/ICE 作档内次序；
  - 调用方可以指定框架，但指定 RICE 而 Reach 来源不足 80% 时，降级为 ICE 并写 `frameworkDowngrade`。
- **B2 输入逐项溯源。** 每个因子值带 `source`：`metric-query | contract | estimate-by:<principalId> | synthesis-finding:<findingId> | assumed`。
  - Effort 只接受 `estimate-by`（估算人）或 `appetite`；模型**不自己估工作量**。缺 Effort 的候选记为 `unestimated`，不进入排名，单独列出。
  - `assumed` 的因子一律按其框架的最低 Confidence 档计（RICE 50%，ICE ≤3）。
- **B3 Confidence 上限继承证据。** Impact 依据是 S063 Finding 时，Confidence 不得高于该 Finding `assertionCeiling` 对应的档：`hypothesis-only → 50%`、其他档位映射由 S063 定稿的枚举决定（S063 已 PASS，本文不另立档位，决策 3）。
- **B4 计算与分带。** 算出分数后，不直接用原始分数排序展示，而是把分数差 <15% 的相邻候选并入同一 `band`，带内标 `tie: true`。展示给人的是名次带，不是小数。
- **B5 敏感性检查。** 对前 `k`（默认 5）名，逐个把每个非 `metric-query` 来源的因子上下各调一档（Impact 一档、Confidence 一档、Effort ±30%），重算名次。任一调整使前 `k` 名集合变化，则该候选 `stable: false` 并记录**哪个因子**导致翻转（`flipDriver`）。这是本 Skill 对「虚假精度」的主要防线。
- **B6 组合检查。** 把入选部分按 `bucket ∈ {incremental, big-bet, table-stakes}`（调用方标注，未标注则 `unclassified`）汇总投入占比。某一类占比 = 100% 或 `big-bet` = 0% 时给出 `portfolioWarning`，只警告不改序。

### C. 切分与取舍
- **C1 投入上限装箱。** 给定 `appetite`（人日 / 人周总量，或 Shape Up 式的固定时长），先扣 `pinned`，再按名次带依次放入，直到放不下。放不下的下一带内若有更小的候选能放进，**不**跳过前面的候选去填缝，除非调用方设 `allowGapFill: true`（决策 4）。
- **C2 MoSCoW 映射（`scope-cut`）。** `pinned → must`；装箱入选中前 60% 投入 → `must`，其余入选 → `should`；未入选但 `stable:false` 的 → `could`；其余 → `wont`，每条 `wont` 必须有 `wontReason`。
- **C3 取舍账（`rerank` 与 `scope-cut`）。** 对每个相对上一版掉出上限或下降一个带以上的条目，写 `displacedBy[]`（挤掉它的候选 id）。
- **C4 改序原因（仅 `rerank`）。** 每个名次带变化必须挂一条 `changeCause`：`new-evidence:<ref> | estimate-revised:<principalId> | deadline-changed | dependency-changed | strategy-shift:<decisionRef>`。说不出原因的变化不允许输出——回退到上一版名次并记 `unexplainedChangeReverted`。

### D. 交付
- **D1** 结果以 `status: "proposed"` 返回。`selected`（W029）或 MoSCoW 切分（W030）成为事实的那一步，是 Workflow 的人类闸门，不是 S068。
- **D2** 给下游的交接只给 id 与名次带：S067（W029 选中解法）、S070（W030 的 must/should 条目）、S069（W032 的名次带）。

## 5. 输入契约（`inputSchema`）
```ts
PrioritizationInput = {
  mode: "solution-select" | "scope-cut" | "rerank" | "direct";
  candidates: Array<{                       // 2–150
    candidateId: string;                    // 调用方内唯一
    kind: "solution" | "requirement" | "roadmap-item";
    title: string;                          // ≤80 字
    sourceRef?: { skill: "S065" | "S067" | "S069" | "S142"; artifactId: string; itemId: string };
    factors?: Partial<Record<"reach" | "impact" | "confidence" | "effort" | "ease",
                     { value: number; unit?: string; source: FactorSource }>>;
    deadline?: { date: string; kind: "regulatory" | "contract" | "certificate" | "signed-commitment"; evidenceRef: string };
    dependsOn?: string[];                   // candidateId
    bucket?: "incremental" | "big-bet" | "table-stakes";
  }>;
  framework?: "RICE" | "ICE" | "MoSCoW";    // 省略则按 B1 规则
  appetite?: { amount: number; unit: "person-day" | "person-week" | "calendar-week" };  // scope-cut 必填
  topK?: number;                            // 3–10，默认 5
  allowGapFill?: boolean;                   // 默认 false
  previousProposalRef?: { proposalId: string; version: number };  // rerank 必填
  newInformation?: Array<{ ref: string; summary: string }>;       // rerank 至少 1 条
  locale: "zh-CN" | "en-US";
  market?: "CN" | "US" | "global";
}
type FactorSource =
  | { kind: "metric-query"; queryRef: string }
  | { kind: "contract"; ref: string }
  | { kind: "estimate-by"; principalId: string }       // 服务端核实（§8）
  | { kind: "synthesis-finding"; synthesisId: string; findingId: string }
  | { kind: "appetite" }
  | { kind: "assumed" };
```
输入不变式（进门校验）：
- **II1** `candidateId` 唯一；`dependsOn` 只引用本批 id。
- **II2** `mode = scope-cut` ⇒ `appetite` 存在，且 `appetite.unit` 与所有 `effort.unit` 可换算（`calendar-week` 只能与 Shape Up 式固定时长比较，不能与人日混用）。
- **II3** `mode = rerank` ⇒ `previousProposalRef` 与 `newInformation.length ≥ 1`。
- **II4** 所有候选 `kind` 相同（A1）。
- **II5** Effort 的 `source.kind ∈ {estimate-by, appetite}`；其余来源的 Effort 在进门时被拒。

## 6. 输出契约（`outputSchema`，S068 专属）
```ts
PrioritizationProposal = {
  proposalId: string; version: number;      // rerank 时 = previous.version + 1
  status: "proposed";                       // S068 永不输出其他值
  mode: Mode; locale: Locale;
  framework: { used: "RICE" | "ICE" | "MoSCoW"; requested?: string;
               frameworkDowngrade?: { reason: "reach-unsourced"; sourcedShare: string /* "6/10" */ } };
  pinned: Array<{ candidateId: string; pinReason: DeadlineKind; deadline: string; effortReserved: number | null }>;
  unestimated: string[];                    // 缺 Effort，不参与排名
  bands: Array<{
    band: number;                           // 1 起
    members: Array<{
      candidateId: string;
      score: { value: number; display: "band-only" };       // 原始分只做审计，UI 只显示 band
      factors: Record<string, { value: number; source: FactorSource; cappedBy?: string /* findingId */ }>;
      tie: boolean;
      stable: boolean; flipDriver?: { factor: string; direction: "up" | "down"; newBand: number };
      dependencyLift?: { liftedFor: string };
    }>;
  }>;
  cut?: {                                   // scope-cut / solution-select
    appetite: Appetite; used: number;
    must: string[]; should: string[]; could: string[];
    wont: Array<{ candidateId: string; wontReason: "over-appetite" | "low-band" | "dependency-blocked" | "superseded" }>;
    selected?: string;                      // 仅 solution-select
  };
  portfolio: { share: Record<"incremental" | "big-bet" | "table-stakes" | "unclassified", string>;
               portfolioWarning?: "single-bucket" | "no-big-bet" };
  changes?: Array<{                         // 仅 rerank
    candidateId: string; fromBand: number | null; toBand: number | null;
    changeCause: ChangeCause; displacedBy?: string[] }>;
  unexplainedChangeReverted?: string[];
  handoff: { S067?: { solutionId: string }; S070?: { mustIds: string[]; shouldIds: string[] };
             S069?: { bandOrder: string[][] } };
}
```
输出不变式（`scripts/check-proposal.mjs`，proposed-unwired，见 §12）：
1. 每个输入 `candidateId` 恰好出现在 `pinned`、`unestimated`、`bands` 三者之一。
2. 对任意依赖 A→B，`band(B) ≤ band(A)`。
3. `framework.used = RICE` ⇒ 至少 80% 的排名候选 `reach.source.kind ∈ {metric-query, contract}`。
4. `cappedBy` 存在时，`confidence.value` ≤ 该 Finding ceiling 映射值。
5. `cut.used ≤ cut.appetite.amount`；`pinned` 的 `effortReserved` 计入 `used`。
6. `cut.wont` 的每条都有 `wontReason`；`must ∩ should ∩ could ∩ wont` 两两不交。
7. `mode = rerank` ⇒ 每个 `fromBand ≠ toBand` 的条目都有 `changeCause`。
8. `solution-select` ⇒ `selected` 至多 1 个，且 `selected` 所在 band 的 `stable = true`；若 band 1 全不稳定，`selected` 省略，由人类闸门选择（E6）。
9. 输出文本不得出现「首选必做」「毫无疑问」类措辞；数字分数不出现在 `title` 或摘要文本中。

类型化错误：
| 错误码 | 触发 | 调用方可以做什么 |
|---|---|---|
| `INPUT_INVALID` | schema 违例，或 II1/II2/II5 | 修正输入 |
| `MIXED_GRANULARITY` | II4 | 拆成两次排序 |
| `DEPENDENCY_CYCLE` | A3 成环 | 返回的 `cycle: string[]` 交人裁决 |
| `APPETITE_REQUIRED` | scope-cut 无 appetite | 补 appetite |
| `PREVIOUS_PROPOSAL_NOT_FOUND` | 引用不存在**或**对调用方不可见（同一码，不泄露存在性） | 确认 id |
| `PROPOSAL_VERSION_STALE` | `previousProposalRef.version` 不是最新 | 取最新版再 rerank |
| `SOURCE_REF_NOT_FOUND` | `sourceRef` / `synthesis-finding` / `deadline.evidenceRef` 不可解析或不可见 | 修引用；**不得**去掉引用静默重试 |
| `ESTIMATOR_UNVERIFIED` | `estimate-by.principalId` 非本组织活跃成员 | 由真实估算人重新提供 |
| `PINNED_EXCEEDS_APPETITE` | 钉住项投入已超 appetite | 人类扩 appetite 或协商截止日 |

## 7. 依赖（能力分类，ADR-120）
- **required**：无，打分与装箱是纯计算。
- **conditional**：`knowledge.read`——读 `sourceRef`、`synthesis-finding`、`previousProposalRef`、`deadline.evidenceRef`；`metrics.read`——校验 `metric-query` 的 `queryRef` 可解析。两个分类名是否已在 ADR-120 目录登记：**UNVERIFIED**。
- **optional**：`sandbox.exec`，运行 `scripts/check-proposal.mjs` 与 B5 敏感性重算。`apps/skill-sandbox/` 目录存在（已读目录）；脚本本身 proposed-unwired。
- 无写能力；riskClass = low。

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可以声明 | 服务端必须核实 |
|---|---|---|
| 是否可调用 S068 | — | 直接调用：Agent 已发布版本的 `agent_versions.skill_version_ids` 固定了 S068（字段在 `packages/contracts/src/identity.ts` 注释中存在，pin 写入路径 `apps/api/src/application/agent-skill-pins/set-agent-skill-pins.ts` 已核实文件存在）；运行时按 pin 拦截的代码位置 **UNVERIFIED**。Workflow 内调用：按 ADR-118 决策 9 由 Workflow 版本固定。 |
| `estimate-by.principalId` | 给出 id | 该 principal 是调用方组织的活跃成员；否则 `ESTIMATOR_UNVERIFIED`。模型不能以用户名义「代估」。成员校验的具体接口 **UNVERIFIED**。 |
| `deadline` | 类型与日期 | `evidenceRef` 必须对调用方可读；可读性只看服务端读权限。服务端**不**判定截止日内容真伪，但会在输出 `pinned` 中带上引用，人类闸门可追查。 |
| `metric-query` 的 Reach | queryRef | queryRef 可解析且调用方有读权；数值以服务端取回为准，不信调用方填的 `value`（不一致时以服务端值覆盖并记录）。proposed-unwired：取数接线。 |
| `previousProposalRef` | id + version | 同组织、调用方可见、version 为最新。 |
| 「领导指定必须做」 | 不能作为钉住理由 | 不在 `deadline.kind` 枚举中；只能以 `strategy-shift:<decisionRef>` 进入 rerank，且 decisionRef 须可解析（例如 S012 决策简报）。 |

## 9. CN / US 差异（实质性的部分）
- **投入单位。** zh-CN 团队常用「人天」，en-US 常用 person-week / story point。S068 不接受 story point 作为 Effort（不可跨团队换算），`unit` 枚举只有人日 / 人周 / 日历周；zh-CN 输出以「人天」显示。
- **钉住项常见来源。** CN：个人信息保护合规整改期限、算法备案 / 安全评估节点、等保测评到期、应用商店合规下架通知；US：SOC 2 审计窗口、州隐私法生效日、客户合同中的 SLA / 安全问卷交付日。只作为 `deadline.kind` 的填写提示，不自动生成钉住项，也不构成法律意见（法律判断归 D009 所挂 Skill）。
- **MoSCoW 译名。** zh-CN 固定为「必须 / 应该 / 可以 / 本期不做」；「本期不做」不译作「不要」，避免被读成永久否决。
- **层级影响。** zh-CN 场景中「领导拍板」式输入更常见，§8 最后一行的规则在两地一致，但 zh-CN 输出对被 `strategy-shift` 改序的条目额外写出 decisionRef 的标题，便于下级追溯。

## 10. 失败模式（S068 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 虚假精度：凭空 Reach × Impact 得出「RICE 1234.56」 | Reach 来源不足 80% 仍用 RICE | 降级 ICE，记 `frameworkDowngrade`；UI 只显示 band |
| F2 | 模型代估工作量 | Effort 来源不是 `estimate-by` / `appetite` | 进门拒绝（II5）；该候选进 `unestimated` |
| F3 | 截止日项被分数埋没 | 有 `deadline` 的候选出现在 bands 中 | 移入 `pinned`，先扣投入 |
| F4 | 依赖倒置：先做依赖方 | 不变式 2 | `dependencyLift` 上提被依赖项 |
| F5 | 无痕改序 | rerank 中名次变了但无 changeCause | 回退该条，记 `unexplainedChangeReverted` |
| F6 | 在不稳定的第一名上做选择 | band 1 全部 `stable:false` 仍给 `selected` | 不给 selected，交人类闸门（不变式 8） |
| F7 | 填缝式装箱：跳过大项塞小项，悄悄改变战略重心 | `allowGapFill=false` 时出现越带入选 | 拒绝；需要时由调用方显式开启 |
| F8 | 组合失衡未被发现：全是增量改进 | `portfolio.share` 单一类 100% | `portfolioWarning`，不改序 |
| F9 | 混粒度排序 | kind 不一致 | `MIXED_GRANULARITY` |

## 11. 评测（`evals/work-stack/S068/`，ADR-119；夹具为合成数据）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | 10 个 requirement，只有 3 个 Reach 来自 `metric-query`，调用方指定 RICE | `framework.used = ICE`，`frameworkDowngrade.sourcedShare = "3/10"`；输出文本无「覆盖 N 用户」 |
| E2 | 8 个候选，其中 2 个 Effort `source.kind = assumed` | 进门 `INPUT_INVALID`（II5）；或调用方改为缺省后，这 2 个在 `unestimated`，不在 bands |
| E3 | scope-cut，appetite = 40 人天；「个人信息出境整改」带 `deadline.kind = regulatory`、Effort 12 人天、ICE 分最低 | 该条在 `pinned` 与 `cut.must`；`cut.used` 含这 12 人天；不出现在 bands |
| E4 | A dependsOn B；B 原始分排第 7，A 排第 1 | `band(B) ≤ band(A)`，B 带 `dependencyLift.liftedFor = A` |
| E5 | A→B、B→A | `DEPENDENCY_CYCLE`，`cycle = [A,B]` |
| E6 | solution-select，前两名 ICE 分 7.2 与 7.0，第一名 Impact 来源为 `assumed` | 二者同 band 且 `tie = true`；第一名 `stable = false`、`flipDriver.factor = impact`；`selected` 省略 |
| E7 | rerank：上一版 v3；新信息只有「竞品发布了 X」一条；输出中 C5 从 band 4 升到 band 1，C2 从 band 1 降到 band 3 | C5 的 `changeCause` 引用该新信息；C2 有 `displacedBy` 含 C5；任何无原因的变化出现在 `unexplainedChangeReverted` |
| E8 | rerank 的 `previousProposalRef.version = 2`，服务端最新为 3 | `PROPOSAL_VERSION_STALE`，无部分输出 |
| E9 | `estimate-by.principalId` 指向另一组织成员 | `ESTIMATOR_UNVERIFIED`；错误中不含该 principal 的姓名 |
| E10 | Impact 依据 S063 finding F3（`assertionCeiling = hypothesis-only`），调用方填 Confidence 100% | 输出 `confidence.value = 50`，`cappedBy = F3` |
| E11 | 用户在 D003 聊天说「老板说 C9 必须 Q3 做完，放最前面」，无 decisionRef | C9 不进 `pinned`；回复提示需要可引用的决策记录（如 S012 简报）才能以 `strategy-shift` 改序 |
| E12 | scope-cut，appetite 20 人天，band 1 有一个 18 人天候选、band 2 有两个 8 人天候选，`allowGapFill=false` | band 1 入选，band 2 不入选；`cut.used = 18`；两个 8 人天项 `wontReason = over-appetite` |
| E13 | 10 个入选项 bucket 全为 incremental | `portfolioWarning = single-bucket`，名次不变 |

打分：不变式 1–9 与 E1–E5、E8、E9、E10、E12、E13 由脚本判定；E6 的稳定性由 B5 重算脚本判定；E7、E11 的回复措辞由 LLM-judge 按逐条 rubric 判定，G5 前人工抽检 20%。

## 12. WorkspaceX 落位
- **Skill 包：** `skills/standard-methods/prioritization/SKILL.md`。`skills/standard-methods/` 已存在（已读目录：interview-synthesis、maau-canvas、user-research-planning、scripts）；本包 **proposed-unwired**，需要跑该目录 `scripts/` 下的 build / verify（脚本名 **UNVERIFIED**）。
- **机械检查：** `scripts/check-proposal.mjs`（不变式 1–9 + B5 敏感性重算），在 `apps/skill-sandbox` 执行。**proposed-unwired**。
- **提议版本存储：** `PrioritizationProposal` 的版本化存储（rerank 依赖）目前没有对应表或接口：**proposed-unwired**。在落地前，W032 可由 Workflow 运行账本保存上一版。
- **看板字段：** 基线任务模型是否有优先级字段 **UNVERIFIED**（`packages/contracts/src` 下未找到任务合同文件）；S068 不写看板，名次只经 S070 / S142 流转。

## 13. 决策
- **决策 1：框架由规则选择，不由模型「觉得合适」。** Reach 有 ≥80% 可溯源时才用 RICE，否则 ICE；scope-cut 固定 MoSCoW。上游把选择交给使用者判断，但在 Agent 场景里模型会倾向选看起来最严谨的 RICE 并编出 Reach。
- **决策 2：展示名次带，不展示分数。** 分差 <15% 视为并列，配合 B5 敏感性检查。原始分数只留审计字段。这把「可解释的先后」和「不可信的精度」分开。
- **决策 3：Confidence 上限继承 S063 的 assertionCeiling，不另建置信档。** 避免与 S063 / S171 形成第二个事实源；映射表只存在于 S068 包内一处。
- **决策 4：装箱默认不填缝。** 跳过高名次大项去塞低名次小项，会在「排序」的名义下改变战略重心；需要时由调用方显式 `allowGapFill`。
- **决策 5：有外部截止日的条目钉住、不打分；「领导要求」不算截止日。** 阶跃式延期成本不适合乘法打分；但把口头指令当钉住会让排序失去意义，因此只接受可引用的决策记录作为 `strategy-shift`。
- **决策 6：模型不估工作量。** Effort 只来自具名估算人或 appetite；这是 S068 与上游 RICE 定义（把 person-months 当输入）的唯一差异点，理由是估算责任必须能落到人。

## 14. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **S065 → S068 交接（回应 S065 §14 提议 4）：** S068 接受 `handoff.S068.solutionIds` 作为 `solution-select` 的候选范围，但要求每个解法补充 Effort 来源；S065 不提供 Effort，因此 W029 在两阶段之间需要一个「估算收集」的人类步骤。由 W029 作者决定是否加闸门。
2. **W030：** 当前行里 S068 与 S070 都涉及容量。建议 W030 作者明确：S068 负责 PRD 层的 MoSCoW 切分（以 appetite 为界），S070 负责冲刺容量；避免两处各算一次容量。
3. **D007 Project / Operations Manager：** 其 Skill 列不含 S068，而其 Workflow 中有排期类工作。仅提请 D007 作者评估，本文不假定需要。

## 15. 未决问题
- `knowledge.read`、`metrics.read`、`sandbox.exec` 是否已在 ADR-120 登记（UNVERIFIED）。
- 提议版本存储落在哪个 feature（proposed-unwired）。
- 15% 并列阈值与 ±一档扰动的取值需在 E6 系列扩充夹具后校准。
- S063 `assertionCeiling` 各档到 Confidence 的完整映射，待 S068 包实现时按 S063 定稿枚举一次性写出。
