# 契约束 `chat-knowledge-graph` — 领域模型与不变量（支撑材料）

> 洋葱最内层，不依赖任何人。覆盖 feature：见 `design-signoff.md` 的 `covers:`（权威）。
> 依据 UC：`requirements/uc-18-1` … `uc-18-5`。架构：`docs/proposals/PROP-ORG-BRAIN-KG-001.md` §3、ADR-114。
> 形状的单一事实源：`packages/contracts/src/chat-knowledge-graph.ts`。本文件只写**不变量**与**实体关系**，不重抄字段。

## 一、实体

| 实体 | canonical 表 | 说明 |
|---|---|---|
| 实体节点 | `ontology_objects`（新建） | 人 / 组织 / 项目 / 产品 / 概念 / 术语 / 指标 / 事件，`KgObjectKind` 封闭 |
| 结论 | `claims`（扩列） | 事实 / 假设 / 决定 / 待办 / 风险，`KgClaimKind` 封闭；生命周期只有 `status` 一个字段 |
| 证据（附件） | `claim_segments`（已有） | 结论 ↔ segment，`stance ∈ {supporting, contradicting}` 同表 |
| 证据（会话消息） | `claim_message_evidence`（F06 新增） | 结论 ↔ chat_messages（外键级联），带 ≤280 字摘录；消息不造成 artifact / segment（file-first：没有字节的版本不是版本）。契约 `KgEvidenceAnchor.sourceKind = chat_message` 时 `sourceRef` 即消息 id；I-5「至少一条 supporting 证据」对两种证据一视同仁 |
| 关系 | `ontology_edges`（扩列） | `KgClaimRelation`（结论↔结论五类）∪ `KgStructuralRelation`（结构类） |
| 动作日志 | `ontology_actions`（新建） | append-only：谁 / 何时 / 什么操作 / 依据 / 结果（accepted / rejected + 原因） |
| 向量 | `object_embeddings`（新建） | 实体与结论的 embedding，按 model/version 分区 |
| 图投影 | AGE 图 `wsx_org_<orgId>` | **可重建投影**，非事实源（ADR-114） |

另有两类会话内的交互对象（不属于本体、不进 AGE）：`KgMemoryCard`（记住 / 忘掉确认卡）、`KgConflictPrompt`（矛盾提醒），存在 PG 普通表里，RLS 与会话一致。

每一行本体数据都带 `org_id / scope_kind / scope_id / created_by / provenance_event_id`。

## 二、三态 ↔ 七态 ↔ 五态对照（S0-6 已由人类确认 2026-09-24）

唯一实现：`claimTriState()`（`knowledge-graph.ts`）。完整对照表见 PROP §3.5。本束只用第一列与三态：

| `claims.status` | 三态 `KgTriState` |
|---|---|
| `proposed` / `reviewed` | `pending` 待确认 |
| `accepted` | `confirmed` 已确认 |
| `contested` | `conflict` 冲突 |
| `superseded` | 不渲染（null） |

界面文案（「AI 记下的 / 你确认过 / 有矛盾」）的唯一来源是 `KG_TRI_STATE_LABEL_ZH`，用词依据 `requirements/06-user-experience.md` R5。

七态（`decision_state`）与五态的派生校验在 L2 / L3 才开放，本束**不写入** `decision_state`。

## 三、不变量（每条都能写成断言）

- **I-1 作用域封闭**：本阶段任何本体行的 `scope_kind ∈ {chat_session, personal}`。写入其他值 ⇒ 执行器拒绝 `KG_SCOPE_NOT_ENABLED`。
- **I-2 单一生命周期字段**：结论的生命周期只有 `claims.status` 一列；三态由 `claimTriState(status)` 派生，不落库。
- **I-3 模型不直写**：`created_by = model` 的行只能经 `ontology_actions` 执行器写入。应用连接角色对本体表没有 INSERT/UPDATE 权限，只有执行器所用的函数/角色有。
- **I-4 模型上限**：`created_by = model` 的结论，`status ∈ {proposed}`。`accepted` 只能由 `created_by = human` 的动作产生，且 `reviewed_by` 非空。
- **I-5 证据必达**：任一 `status ≠ superseded` 的结论至少有一条 `stance = supporting` 且未失效的证据。
- **I-6 反对证据不可删**：`stance = contradicting` 的证据行不因任何人工动作被物理删除；只能随其源被删除而失效（I-10）。
- **I-7 幂等**：`(source_ref, pipeline_version)` 相同的抽取任务，重复执行后本体行数不变。
- **I-8 晋升是复制**：L1 结论必有 `derived_from` 边指向一条 L0 结论；L0 结论的 `scope` 永不改变。
- **I-9 晋升前置**：只有 `status ∈ {proposed, reviewed, accepted}` 且全部证据未失效的 L0 结论可产生 L1 副本；非 accepted 的，在同一事务里先以晋升人的身份转 accepted（U-3）。冲突态（contested）一律拒绝。
- **I-10 失效传播**：源（消息 / 附件 / 会话）被删除 ⇒ 仅由它支撑的结论 `status = superseded` 且 `revoked_at` 非空；其 L1 副本同样失效；相关边 `status = invalidated`。
- **I-11 canonical 为准**：召回的可见性判定只读 canonical 表（`status` / `revoked_at` / RLS）。AGE 与向量投影的滞后**不能**使失效内容重新可见。
- **I-12 AGE 只返回 id**：图查询的结果集只包含 id；内容一律回 canonical 表按 RLS 读取。
- **I-13 租户图隔离**：org A 的会话不能查询 org B 的 AGE 图（图名由 org id 派生，连接只授权本 org 图）。
- **I-14 L1 私有**：`scope_kind = personal` 的行只对 `scope_id = 当前用户` 可见；会话其他成员经本会话也读不到所有者的 L1。
- **I-15 人工动作的操作者恒为人**：`KgHumanAction` 的每一种都要求调用者为人类会话；Agent 身份 ⇒ `KG_ACTOR_NOT_HUMAN`。
- **I-17 卡片只由人执行**：`KgMemoryCard` 从 open 变为 done 只能经 `actOnMemoryCard`，且调用者是人类会话；Agent 只能创建 open 状态的卡片。
- **I-18 一轮至多一张主动卡**：同一 `messageId` 的 `KgTurnMemory.prompt` 至多一个，冲突卡优先。
- **I-19 忽略即不再提醒**：一对结论被 `resolveConflict{ignore}` 后，在其中任一条被改之前，不再为这一对生成 `KgConflictPrompt`。
- **I-16 修订号单调**：会话知识的 `revision` 每次成功动作 +1；`basedOnRevision ≠ 当前` ⇒ `KG_REVISION_CHANGED`，不静默覆盖。

## 四、跨束依赖（只调用，不重定义）

- 会话可见性与所有者判定 → phase-01 `chat` 束（UC-0 / F108）。
- 召回形状 `ContextPack`、`ClaimStatus`、`RetrievalChannel` → phase-00 `context-pack` 束。
- 附件摄取与 segments → phase-01 `files` 束；删除级联端口 `invalidateOntologyEdges` 由本束实现（`files` 束 `OUTBOUND_PORTS`）。
- 上下文组装位置（`ContextAssemblyPort` 内侧，L3 召回）→ phase-01 `chat-context-engine` 束，`ModelCallPort` 不动。
