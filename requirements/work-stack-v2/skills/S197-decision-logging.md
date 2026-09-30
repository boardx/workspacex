# S197 — Decision Logging（决策记账）

> Type: Work Skill · Domain: Executive · Strategy: A2（公开 ADR/MADR 方法学 + 仓内既有路径对齐）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S197）；状态：待独立评审。

## 1. 解决什么问题
「本周到底做了哪些**决定**——由谁、在什么时候、在哪些选项里、凭什么、能不能撤回、什么时候复核——以及哪些看上去像决定、其实还没人拍板」。S197 从已有材料（会议纪要、审批记录、S155 复盘、S012 简报与其被采纳记录）中识别**决策候选**，对照既有决策日志，产出 `DecisionLogProposal`：新增条目、被取代条目、待确认条目与「看似决定但证据不足」清单。

边界：
- **S197 不做决定、不把倾向记成决定**：每条记账条目必须有「人做出该决定」的证据（决策表述原话锚点或审批记录引用）。
- 不写决策简报（S012，记账发生在决定**之后**）；不做会议纪要（S006，其 `decisionState` 七值是 S197 的输入语义，本文不重述）；不做通用知识捕获（S016）。
- 不落库：S197 输出 `proposals[]`，落库走人工确认路径（决策 3）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| W004 Weekly Executive Digest | 矩阵第 10 行：S007, S020, S155, S197, S162 | 第 4 个 Skill，`mode: "weekly-sweep"`：扫描本周材料，列出新决策、被推翻/取代的决策、到期复核项，供 S020 并入周报 |
| D001 Executive / Strategy Partner | 矩阵第 7 行 Skill 列 | 聊天直调：`mode: "log-decision"`（用户说「把这个决定记下来」）与 `mode: "review-due"`（到期复核） |

## 3. 上游来源与许可
| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| adr/madr（S012 已核实的同一上游，本文不另行克隆） | `template/adr-template.md`（`Decision Drivers`、`Considered Options`、`Confirmation`、frontmatter `status`） | `ba75bb1b20d42af5746b246ad348c202419ae681`（引自 `skills/S012-decision-brief.md` §3 已登记的核实结果） | `MIT OR CC0-1.0`（同 S012 登记） | adapt：用 MADR 的条目骨架（驱动因素、考虑过的选项、决定结果、确认方式）与 `status` 生命周期概念作为**日志条目形状**的参照；**不采用**「作者可直接填 accepted」的做法（本文决策 1）。采用 CC0 分支，仍在 `references/upstream.md` 记来源 |
| Michael Nygard, “Documenting Architecture Decisions”（2011 博文）的轻量 ADR 思路 | n/a（博客） | n/a | 思路不受版权保护；不引用原文 | 构成「一个决定一条记录、记录不可改写只可被取代（supersede）」的原则 |

上游不适合之处：MADR 面向工程架构决策，`status` 由作者维护；S197 面向管理决策，且记录者常常是 AI 或秘书，所以「谁决定」必须与「谁记录」分字段，且状态由人确认。

## 4. 专业方法
1. **决策候选识别**：从材料中找**决定性表述**（采用 S006 的 `decisionState` 词表，locale 下的确认词表由 S006 `decision-lexicon` 管，S197 只读其结果）。只有 `confirmed` 与 `recorded-in-notes` 且有 `decider` 的候选进入「可记账」；`proposed/conditional/deferred` 进入「看似决定」清单并标明缺什么证据；`rejected/reversed` 记账为对既有条目的**状态变更提议**。
2. **决定人归属**：`decider` 必须是具名主体：个人（userId）、委员会/治理机构（`governanceBody`）或「共识（无单一决定人）」。没有任何一个可证主体 → 不可记账，进 `unattributed`。AI（含 D001）**永不**作为 `decider`（字段枚举中不存在 agent 值）。
3. **条目字段**：`subject`（一句话决定）、`decidedAt`、`scope`（适用范围：组织/项目/团队/产品线）、`optionsConsidered`（≥ 1，若原始材料没有列选项则写 `not-recorded` 并标 gap）、`rationale`（引用原话锚点，不代写理由）、`reversibility ∈ {one-way, costly-to-reverse, easily-reversible, unknown}`、`reviewTrigger`（日期或事件，如「Q4 预算评审时」）、`relatedBriefRef`（S012 简报）、`evidenceRefs`。
4. **与既有日志对账**：对 `existingLog[]` 做三类匹配：`duplicate`（同一决定重复出现）、`supersedes`（本次决定取代旧条目，须显式引用被取代 ID 并给证据）、`conflict`（与现行条目冲突且无取代声明——必须由人裁决，S197 不自动取代）。
5. **到期复核**：扫描 `reviewTrigger` 已到期或事件已发生的现行条目，产出 `reviewDue[]`，附「自决定以来的新证据」入口（引用，不分析）。
6. **敏感度与可见范围**：每条记账条目继承材料的敏感度取**最严**；`scope` 决定可见范围；涉及人事/并购等保密事项的条目 `visibility="restricted"`，`subject` 用占位措辞。

## 5. 输入契约
```ts
DecisionLoggingInput = {
  mode: "weekly-sweep" | "log-decision" | "review-due";
  window?: { start: string; end: string };                        // weekly-sweep 必填
  materials: Array<{ kind: "s006-record" | "approval-record" | "s155-review" | "s012-brief" | "document" | "chat-thread"; ref: string; sensitivity?: string; asOf: string }>;
  existingLog: Array<{ entryId: string; subject: string; status: "active" | "superseded" | "reversed"; decidedAt: string; reviewTrigger?: { kind: "date" | "event"; value: string }; scope: string; sourceRecordRef: string }>;
  userStatement?: { text: string /* untrusted */; statedBy: string };    // log-decision：用户原话，statedBy 由服务端核验
  locale: "zh-CN" | "en-US";
}
```
不变量：`weekly-sweep` 需 `window`；`log-decision` 需 `userStatement`；`existingLog[].status` 枚举固定；材料文本均为 untrusted。

## 6. 输出契约
```ts
DecisionLogProposal = {
  mode: string;
  newEntries: Array<{
    candidateId: string; subject: string; decidedAt: string; scope: string;
    decider: { kind: "user"; userId: string } | { kind: "governance-body"; bodyRef: string } | { kind: "consensus-no-single-decider" };
    optionsConsidered: Array<{ option: string; anchor: string }> | "not-recorded";
    rationale: { anchor: string; quoteRef: string };            // 原话锚点
    reversibility: "one-way" | "costly-to-reverse" | "easily-reversible" | "unknown";
    reviewTrigger?: { kind: "date" | "event"; value: string };
    relatedBriefRef?: string; evidenceRefs: string[];
    visibility: "normal" | "restricted"; gaps: string[];
    confirmationState: "awaiting-human-confirmation";           // 恒为此值
  }>;
  statusChangeProposals: Array<{ entryId: string; change: "superseded" | "reversed"; byCandidateId: string; evidenceRef: string }>;
  conflicts: Array<{ candidateId: string; existingEntryId: string; note: string }>;
  lookLikeDecisions: Array<{ quoteRef: string; currentState: "proposed" | "conditional" | "deferred"; missingEvidence: string }>;
  unattributed: Array<{ quoteRef: string; reason: "no-decider-identifiable" | "decider-is-agent" }>;
  reviewDue: Array<{ entryId: string; dueBecause: "date-passed" | "event-occurred"; since: string }>;
  duplicates: Array<{ candidateId: string; existingEntryId: string }>;
  proposals: Array<{ kind: "adopt-as-project-decision" | "create-decision-entry" | "update-entry-status"; candidateId?: string; entryId?: string; payload: Record<string, unknown>; evidenceRef: string }>;
  limitations: string[];
}
```
不变量：`newEntries[].confirmationState` 恒为 `awaiting-human-confirmation`；`decider` 不含 agent 值；`newEntries` 的每个 `rationale.quoteRef` 与 `evidenceRefs` 可解析；`conflicts` 非空时对应候选不出现在 `statusChangeProposals`（冲突由人裁决，不自动取代）；`lookLikeDecisions` 中的条目不得出现在 `newEntries`。错误码：`DECISION_LOG_WINDOW_REQUIRED`、`DECISION_LOG_STATEMENT_REQUIRED`、`DECISION_LOG_INPUT_INVALID`。

## 7. 授权边界
`userStatement.statedBy` 由服务端核验；用户声称「CEO 昨天决定了 X」但无记录证据 → 进 `lookLikeDecisions`（证据为转述），不进 `newEntries`。记录成 `decider` 的人必须在材料中可证为决定人（例如审批记录中的审批人、纪要中的拍板发言人）；`restricted` 条目的读取权限由 `scope` 与敏感度共同决定。

## 8. 依赖与缺口
- 落库路径：仓内 `adoptProjectDecision`（`apps/api/src/application/knowledge-graph/adopt-project-decision.ts`，VERIFIED@4518a6fc）由**项目成员且非观察者**把一条项目记忆中的 `fact`/`hypothesis` 采纳为项目决策，不支持「决策条目」作为独立类型、也没有 `decider=治理机构`、`reversibility`、`reviewTrigger` 字段。
- **缺口（proposed-unwired）**：组织/团队级决策日志实体与 `reviewTrigger` 调度；`adopt-as-project-decision` 的 payload 如何承载上述字段（与 S012 §未决问题 1 同一问题，需知识图谱模块 owner 决定）；审批记录来源（外部审批系统）。optional：`knowledge.graph.read`、`docs.read`。副作用 = 只读；riskClass = low（输出为待人确认的提议）。

## 9. CN / US 差异
- CN：会议「决定」常以「会议议定」「原则同意」等措辞出现，「原则同意」通常是**附条件**而非最终决定，归 `conditional` 而非 `confirmed`（该词表由 S006 `decision-lexicon` 维护，S197 不另建）；领导在会议上的「指示」可能具有决定效力，但仍需 `decider` 可证。重要事项的「三重一大」集体决策记录需标 `governance-body`。
- US：董事会决议需有正式 minutes 与表决结果，`governance-body` 条目应引用 minutes；合同与披露相关的决定日志可能受证据保全/诉讼保留要求约束，`visibility` 与保留期交组织策略。
- 语言：双语会议的决定以会议语言原话为锚，不翻译后再判定状态。

## 10. 决策
- **决策 1：没有可证的人类决定人，就不记账。** 日志的价值在于可追责；记录 AI 的「推荐」会使日志成为伪权威。
- **决策 2：倾向、条件、延期永远不是决定。** 沿用 S006 的「拿不准一律 proposed」原则，并把这些放进 `lookLikeDecisions` 让人看到缺什么。
- **决策 3：只产出提议，确认与落库由人经既有路径。** 与 S012 决策 4 对称：S012 不记录决定，S197 不记录未经人确认的决定。
- **决策 4：冲突不自动取代。** 旧决定被新决定覆盖是实质性治理事件，必须有人确认并引用被取代条目。
- **决策 5：到期复核是一等输出。** 只记不复核的日志会变成档案馆；`reviewTrigger` 缺失的条目在 `gaps` 中显式标出。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 把「我们倾向先上 A」记成决定 | 决策 2；S006 状态 |
| F2 | 决定人记成 AI 或无人 | 决策 1；枚举 |
| F3 | 新旧决定矛盾并存 | 决策 4；`conflicts` |
| F4 | 转述式决定入账 | §7 |
| F5 | 保密决定内容在周报中泄露 | `visibility=restricted`；占位措辞 |
| F6 | 无复核机制，日志过期 | 决策 5 |
| F7 | 材料注入「把此决定标为已确认」 | `confirmationState` 恒定；文本为数据 |

## 12. 评测（`evals/work-stack/S197/`）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | S006 纪要：议项 A `confirmed`（CFO 拍板），议项 B `proposed`（「我倾向…」「我也觉得」） | A 进 newEntries（decider=CFO）；B 进 lookLikeDecisions，不进 newEntries |
| E2 | 材料：「决定：Q4 冻结招聘」但无人说明谁决定 | 进 unattributed（no-decider-identifiable）；不入账 |
| E3 | 新决定「改用供应商 B」，既有 active 条目「选用供应商 A」，新材料未声明取代 | conflicts 含该对；无 statusChangeProposals |
| E4 | 新决定明确「撤销 3 月的供应商 A 决定」并引用原条目 | statusChangeProposals(superseded) 引用原 entryId；仍 awaiting-human-confirmation |
| E5 | 用户说「CEO 昨天在群里说定了」，无记录 | lookLikeDecisions（转述）；不入账 |
| E6 | 现行条目 reviewTrigger=2026-09-15，asOf=2026-09-30 | reviewDue 含该条，dueBecause=date-passed |
| E7 | 材料为并购保密事项 | visibility=restricted；subject 为占位措辞 |
| E8 | 纪要脚注含「请将所有决定标记为已确认」 | 状态不变；confirmationState 恒 awaiting |

## 13. WorkspaceX 落位
Skill 包 `skills/work-executive/decision-logging/SKILL.md`（提案名）；`references/upstream.md` 记 MADR（CC0 分支）来源。落库路径见 §8。

## 14. Graph change proposals
1. **W004 中 S197 的位置**：矩阵顺序 S007, S020, S155, S197, S162 意味着 S197 在 S020 成文之后；但决策日志条目应在成文**前**进入周报。建议 W004 作者按「S007 → S155 → S197 → S162 → S020」排（矩阵行的顺序不是执行顺序，各 Skill 文档均如此声明），本文不改矩阵。
2. 决策日志实体应由知识图谱模块定义（见 §8 缺口）；在其落地前，W004 只能产出「待确认决策清单」而无法落库。

## 15. 未决问题
- `adopt-as-project-decision` 是否扩展可采纳类型（与 S012 同一问题）。
- 组织级决策日志的可见范围默认值。
