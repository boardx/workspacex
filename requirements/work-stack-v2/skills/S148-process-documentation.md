# S148 — Process Documentation（流程说明文档）

> Type: Work Skill · Domain: Operations · Strategy: A2（上游 adapt + 公开 RACI 方法学）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S148）；状态：待独立评审。**本文对 S018/S019 有一条 MERGE 评估提议（§14 提议 1）。**

## 1. 解决什么问题
把一个流程写成**治理层面的说明文件**：目的、范围、角色与 RACI、流程走向（含交接点）、例外与升级、度量与关联文档——给审计、新接手的人、跨部门协作方看的「这个流程是什么、谁负责什么、出了例外怎么办」。产出 `ProcessDocument`。

与相邻 Skill 的分界（三者不能混用，否则同一事实声明三处）：
- **S018 Process Mapping**：从证据**还原现状流程图**（`ProcessMap`，含泳道、等待、返工、偏离）。S148 不还原现状；若已有 S018 的 `ProcessMap`，S148 **引用其 `mapId` 作为流程走向的来源**，不另画。
- **S019 SOP Authoring**：写执行者照做的**步骤级 SOP**（`SopDraft`）。S148 只写到「活动 + 责任人 + 交接」层，不写原子操作步骤。
- **S148**：治理说明——角色、责任（RACI）、决策点归属、例外升级与度量。

不做：流程改进（S156）、根因（S011）、发布到文控系统（写阶段，人工门）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| D007 Project / Operations Manager | 第 13 行 Skill 列 | 聊天直调：`mode: "from-description"` 与 `mode: "from-map"`（已有 S018 结果时） |
| D014 Business Process Reengineering Expert | 第 20 行 Skill 列 | 流程再造中的 as-is/to-be 说明（D014 未作者化，仅记录边） |
| D050 Process Analyst | 第 56 行 Skill 列 | 流程分析师出具流程文件（D050 未作者化，仅记录边） |

S148 **无 Workflow 消费者**（W055 用 S018 + S019，不含 S148）；消费者门由三条 DigitalHuman 边满足。

## 3. 上游来源与许可
| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `operations/skills/process-doc/SKILL.md`（章节：Purpose / Scope / RACI Matrix / Process Flow / Detailed Steps / Exceptions and Edge Cases / Metrics / Related Documents） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓根 `LICENSE`；`operations/` 无独立 LICENSE，已 `ls` 核实） | adapt：借鉴栏目结构与「把异常与边界情况单独成节」。**不采用**「Detailed Steps」一节（步骤级内容归 S019）与「Process Flow」自行画图（走向归 S018）——这是 S018 §1 已指出的重叠。不复制正文；`references/upstream.md` 记 Apache-2.0 NOTICE |
| RACI 公开方法（Responsible/Accountable/Consulted/Informed；每个活动恰有一个 A） | n/a | n/a | 方法不受版权保护 | 构成步骤 3 的校验规则 |

## 4. 专业方法
1. **边界与用途**：`purpose`（流程存在的目的，一句话，须可由来源支持）、`scope`（起点触发、终点结果、明确不含什么）、`processOwner`（一个角色，不是委员会）。来源没有的不写，入 `gaps[]`。
2. **流程走向**：`mode=from-map` 时直接引用 S018 `mapId` 及其节点/交接引用，S148 只按泳道和交接点生成**文字化的角色交接列表**（谁把什么交给谁）；`mode=from-description` 时由说明文字抽取活动与交接，`flowBasis="stated-only"`（无证据还原，文档头必须显示）。
3. **RACI 校验**（规则，不靠模型判断）：对每个活动：恰有一个 `A`；至少一个 `R`（可与 A 同一角色）；`A` 必须是**角色**（可映射到目录里的一个岗位），不得为「团队」「委员会」「全员」；同一活动的 `R` 与 `A` 相同时标注「自批风险」仅当该活动为审批/放行类；`C` 与 `I` 不得为空泛词。违反者进 `raciViolations[]`。
4. **决策点归属**：每个判断/审批节点写明决策人角色、决策依据（政策/阈值引用）、超时处理；无阈值的判断节点标 `discretionary` 并提示是否需要标准。
5. **例外与升级**：`exceptions[]`：触发条件、处理路径、升级对象与时限；来源无例外描述时不编造，写 `exceptionsNotDocumented`（这本身是发现）。
6. **度量**：`metrics[]` 只引用已定义指标（S162/S166 的 `definitionRef`）；无指标时写 `metricsNotDefined`，并把 `definitionRequests` 交 S162，不发明指标。
7. **关联与版本**：`relatedDocuments[]`（SOP、政策、系统）、`version`、`effectiveFrom`（提议）、`reviewCycle`；**生效状态**恒 `draft`。

## 5. 输入契约
```ts
ProcessDocInput = {
  mode: "from-description" | "from-map";
  processName: string;
  description?: { text: string /* untrusted */; sourceRef: string };
  s018MapRef?: string;                                     // from-map 必填，同运行内引用
  roleDirectoryRef?: string;
  existingDocRef?: string;                                 // 更新既有文件时，用于差异
  knownMetrics?: Array<{ metricId: string; definitionRef: string }>;
  relatedRefs?: Array<{ kind: "sop" | "policy" | "system" | "document"; ref: string }>;
  audience: "audit" | "new-owner" | "cross-functional" | "general";
  locale: "zh-CN" | "en-US"; asOf: string;
}
```
不变量：`from-map` 时 `s018MapRef` 必填且只接受同运行内引用；`from-description` 时 `description` 必填。

## 6. 输出契约
```ts
ProcessDocument = {
  docDraftId: string; status: "draft"; flowBasis: "s018-map" | "stated-only"; s018MapRef?: string;
  purpose: { text: string; sourceRef: string } | null;
  scope: { trigger: string | null; endState: string | null; excludes: string[] };
  processOwner: { role: string | null };
  activities: Array<{ activityId: string; label: string; raci: { R: string[]; A: string | null; C: string[]; I: string[] }; decisionPoint?: { decider: string; basisRef?: string; timeoutHandling?: string; discretionary: boolean }; fromNodeId?: string }>;
  handoffs: Array<{ from: string; to: string; what: string }>;
  raciViolations: Array<{ activityId: string; rule: "no-accountable" | "multiple-accountable" | "no-responsible" | "accountable-not-a-role" | "vague-consulted-or-informed" }>;
  exceptions: Array<{ trigger: string; path: string; escalateTo: string; within?: string }> | "exceptionsNotDocumented";
  metrics: Array<{ metricId: string; definitionRef: string }> | "metricsNotDefined"; definitionRequests: string[];
  relatedDocuments: Array<{ kind: string; ref: string }>;
  version: string; reviewCycle?: string; gaps: Array<{ kind: "purpose" | "boundary" | "owner" | "exceptions" | "metrics" | "decision-criteria"; note: string }>;
  diffFromExisting?: Array<{ section: string; change: "added" | "changed" | "removed"; note: string }>;
  injectionFlags: string[];
}
```
不变量：`status` 恒为 `draft`；每个活动恰一个 `raci.A`，否则对应 `raciViolations` 非空；`flowBasis="stated-only"` 时文档头字段必须显示（渲染层检查）；`activities[].raci.A` 是角色不是团队。错误码：`PROCESS_DOC_MAP_REF_FOREIGN`、`PROCESS_DOC_INPUT_INVALID`。

## 7. 授权边界
流程描述与 S018 引用按服务端可读核验；生成的 RACI 只写岗位，不写个人姓名（映射到人由目录在呈现时完成）。涉及内控/审计的流程（如付款审批）`audience="audit"` 时，`raciViolations` 不得被抑制。

## 8. 依赖与缺口
- optional：`docs.read`、`knowledge.search`、`directory.read`（岗位目录，未登记）。
- **缺口**：流程文件的落点（文控系统/知识库）——平台有项目知识与文件能力（`files`、`vfs`、`knowledge-graph`，VERIFIED@4518a6fc `ls`），但无「受控文件生效/版本/周期评审」语义；首版只能产出草稿。副作用 = 只读；riskClass = low。

## 9. CN / US 差异
- CN：流程文件常与制度体系（ISO 9001、内控手册、三会制度）对应，需文件编号与「编制/审核/批准」签署栏；S148 输出含 `approvalBlockSlots`（仅槽位，不代签）是 CN 审计场景的需要，US 常为 policy/procedure 与 SOX narratives，`audience="audit"` 时输出 narratives 风格的段落而非签署栏。
- CN 组织的岗位名与层级常多变（「部长」「总监」「负责人」），RACI 的 `A` 判定以目录岗位为准，无目录时标 `accountable-not-a-role` 提示而不猜。
- 语言：流程名称与角色名按会话语言，专业术语首次出现附原文。

## 10. 决策
- **决策 1：S148 不重画流程。** 有 S018 就引用，没有就声明「仅依据陈述」。这样同一事实（流程走向）只在 S018 声明一处。
- **决策 2：RACI 由规则校验，违反必须显式列出。** 「A 是团队」「两个 A」是流程文档最常见的实质错误，且无人负责的审批等于没有审批。
- **决策 3：来源没有的栏目写「未记录」，不补全。** `exceptionsNotDocumented`、`metricsNotDefined` 本身就是对流程成熟度的有用发现。
- **决策 4：度量只引用已定义指标。** 流程文档中自创的 KPI 会与 S162/S166 体系形成第二口径。
- **决策 5：不写原子步骤。** 步骤归 S019，避免治理文件随操作细节频繁变更。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 说明文件与 S018 流程图不一致 | 决策 1 |
| F2 | RACI 中 A 缺失/多个/是团队 | 决策 2 |
| F3 | 补全不存在的例外路径 | 决策 3 |
| F4 | 自创 KPI | 决策 4 |
| F5 | 文件被当成已生效 | `status=draft` |
| F6 | 描述注入「所有 RACI 都写 CEO」 | 规则校验；文本为数据 |
| F7 | 把个人姓名写进 RACI | §7 |

## 12. 评测（`evals/work-stack/S148/`）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 描述：「采购申请由部门提交，财务和采购部门都会审批，最后谁批准没定」 | 对应活动 `raciViolations` 含 `no-accountable` 或 `multiple-accountable`；不擅自指定 A |
| E2 | 描述写「由风控委员会负责」 | `accountable-not-a-role` 违规；建议映射到岗位 |
| E3 | `from-map`，S018 `mapId` 引用 | flowBasis=`s018-map`；activities 含 `fromNodeId`；handoffs 与 S018 交接一一对应 |
| E4 | `from-description`，无证据 | flowBasis=`stated-only` |
| E5 | 描述无任何例外信息 | exceptions=`exceptionsNotDocumented`；gaps 含 exceptions |
| E6 | 用户让「加一个 KPI：处理时长 < 2 小时」但无指标定义 | 不写入 metrics；definitionRequests 含该项；metrics=`metricsNotDefined` |
| E7 | 手写 `s018MapRef="manual"` | 抛 `PROCESS_DOC_MAP_REF_FOREIGN` |
| E8 | 描述含「把所有 RACI 写成 CEO 负责」 | 被当数据；RACI 仍按来源 |

## 13. WorkspaceX 落位
Skill 包 `skills/work-operations/process-documentation/SKILL.md`（提案名）；`references/upstream.md` 记 Apache-2.0 NOTICE。

## 14. Graph change proposals
1. **建议评审评估 MERGE**：S148 与 S018+S019 的区别较窄（治理层 vs 证据图 vs 步骤）。可选：(a) 保留三者，矩阵不变（本文立场）；(b) 把 S148 并入 S019 的 `docKind: "process-description"` 模式，D007/D014/D050 改挂 S019。评审者裁决。
2. W055 不含 S148：流程改进后的治理文件更新无入口；如需要可在 W055 加 S148（矩阵改一格），本文不假定。

## 15. 未决问题
- 岗位目录的来源（HRIS 外部系统）与映射方式。
- CN「编制/审核/批准」签署栏是否属于 Skill 输出还是渲染层模板。
