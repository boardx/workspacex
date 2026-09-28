# 契约束 `work-content` — 领域模型与不变量（支撑材料）

> 形状权威在 `packages/contracts/src/work-content.ts`；本文件是**不变量**与**枚举封闭性**的唯一收敛点（ADR-023）。
> 依据：ADR-116、ADR-117、ADR-118（#4/#5/#6/#9）、ADR-119（#3/#4）、ADR-120、`requirements/05-content-lines.md` R3/R4/R7/R9。

## 一、现状基线（本束断言只来自以下已读文件）

- `packages/contracts/src/workflow-runtime.ts`：`WorkflowInstanceStatus` 为 `running | awaiting_gate_decision | blocked_permission | cancelling | succeeded | failed | cancelled | rejected | needs_attention`；`WorkflowErrorCode` 含 `workflow_not_allowed`(403)、`skill_version_unresolved`(422)、`gate_not_open`、`state_version_conflict` 等。05 号文件所写 `requested / awaiting_* / completed*` **不是**现有枚举成员，本束按现有枚举映射（见 I-C11、Q1）。
- `packages/contracts/src/agent-role.ts`：`WorkflowStableId = /^W\d{3}$/`、`workflowAllowlist` 固定到 Workflow stableId；无 `skillGaps` 字段（见 Q4）。
- `packages/contracts/src/work-skill-meta.ts`：`WorkSkillChannel = candidate|verified|deprecated`、`WorkSkillGateId = G0…G6`；`packages/contracts/src/work-eval.ts`：`PHASE1_GATES = G0…G5`。
- `packages/contracts/src/board.ts`：`SourceKind` 七值（`手工创建` 等），无 Workflow 运行来源。
- `apps/api/src/domain/board/card-projection.ts`：纯函数投影，项目 4 列 `todo/in_progress/review/done` + 折叠 inbox，全局 5 列；调用方先按权限过滤。
- `apps/api/src/domain/board/source-kind.ts`：来源枚举单源于 `board.SOURCE_KINDS`，唯一写路径 `MANUAL_SOURCE_KIND`。
- `docs/adr/ADR-118-generic-workflow-runtime.md` 第 9 条：Workflow 固定 Skill 版本，Agent 无需挂载。`ADR-119` 第 4 条：只有 verified（过 G5）的 Skill 能被官方 Agent 绑定。

## 二、实体与值对象

| 实体 / 值 | 来源 | 说明 |
|---|---|---|
| Skill 包源 | `skills/work-{research,product,sales,shared}/<skill>/{SKILL.md,references/}` | frontmatter `metadata.work` = WorkSkillManifest（ADR-117） |
| Starter-pack | `skills/starter-packs/<pack>/<semver>.json` | 沿用现有 JSON 结构；每文件 `digest=sha256` |
| WorkflowDefinition 模块 | `apps/api/src/.../workflow/definitions/<W>.ts` | 导出 `{id, version, skillPins, stages, gates, effects}`，注册到 runtime 图工厂 |
| WorkflowCatalogItem | 派生视图 | 可用性由注册校验结果决定 |
| 官方角色包内容（4 份） | 格式归 agent-role 束 | 本束只填白名单与 skillGaps 值 |
| 内容产出 | `workflow_stage_outputs` 业务行指针 | ResearchBrief / DataNeedsStatement / PrdArtifact |
| CRM 写入 receipt | runtime `workflow_receipts`（scope=effect） | 逐条 `CrmWriteItemOutcome` |
| BoardWorkflowRunCard | 派生只读投影 | 不是第二事实源 |

## 三、封闭枚举

`WorkContentErrorCode`、`WorkflowAvailability`、`WorkContentOutcome`、`CrmWriteItemOutcome`、`BoardRunBadge`、`WorkContentLine`。新增成员须改本文件 + 契约 + 经签核。实例状态**不**在本束新增。

## 四、不变量

- **I-C1 组合单源**：每个 Workflow 定义的 `skillPins` 的 Skill ID 集合 = `WORKFLOW-SKILL-MATRIX.md` 对应行；每个角色包 `workflowAllowlist` = `DIGITALHUMAN-COMPOSITION-MATRIX.md` 对应行。代码/pack 中不得有第二份组合表（R7，lint V8）。
- **I-C2 只实现 PASS 实体**：进入 pack / 注册表的实体必须在 `WORK-STACK-320-LIST.md` 第一阶段节且评审 PASS（修订 R1）；W017 不得出现。
- **I-C3 pack 可重复**：同一源两次构建 digest 逐文件相等；任一文件篡改 → 校验失败并指名文件；失败不生成半个 pack。
- **I-C4 注册隔离**：Workflow 注册失败只使该 Workflow `unavailable` 且 `unresolvedPins` 非空；`available ⇔ unresolvedPins = ∅`；不影响其它 Workflow。
- **I-C5 Pin 不依赖挂载**：Workflow 运行只看其固定 Skill 版本，与 Agent 的 `skill_version_ids` 无关（ADR-118 #9）。
- **I-C6 证据**：`EvidencedClaim.evidenceRefs` 非空；无材料 → `DataNeedsStatement` + `outcome=with_holds`，不产出结论。
- **I-C7 外部效果**：一切 `crm.write` / `mail.send` / 发布经 effect-gateway；执行前重查权限（ADR-118 #6）；批准绑定 digest（item / record+framing+changeSet），上游重算即失效。
- **I-C8 幂等**：同一 effect receipt 重放不产生第二次写入；未 finalize 的 receipt 恢复时先读回再决定。
- **I-C9 终局**：内容线不新增实例状态；`completed_with_holds` = `succeeded` + `WorkContentOutcome.with_holds`。
- **I-C10 无自动批准**：事件触发（`recording_completed` / `calendar_event_ended`）的 W013 实例在任何组织配置下都停在 G1。
- **I-C11 Board 映射**（纯函数）：`running | cancelling → in_progress`；`awaiting_gate_decision | blocked_permission → review`；`succeeded → done`(badge done)；`rejected → done`(badge rejected)；`failed | cancelled | needs_attention → done`(badge failed)。
- **I-C12 Board 权限**：先按实例读权限过滤再投影；无权限者投影中不存在该卡 ID；项目视图与全局视图卡 ID 集合相同；`draggable=false`。
- **I-C13 新商机字段**：`NewOpportunityPayload` 只含 5 字段（strict），amount/closeDate/stage 只进 `deferredProposals`。
- **I-C14 收件人**：W013 跟进邮件收件人只由服务端解析；录音同意不明的原话不得进入对外邮件。
