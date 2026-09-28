# 契约束 `agent-role` — ② 用例

依据 `requirements/03-agent-role.md` R3/R4。operation 名见 `packages/contracts/src/agent-role.ts`。

## UC-1 角色字段冻结（AG01）
管理员 `updateAgentRoleDraft`（仅 `catalogSource='org'`）→ 发布走既有审核 → 快照含 7 个新字段。
- A：改草稿不影响已发布快照（I-2）。
- E：官方 Agent → `OFFICIAL_ROLE_FIELDS_LOCKED`；并发 → `VERSION_CHANGED`；非管理员 → `ROLE_INSUFFICIENT`。

## UC-2 toolPolicy 放宽（AG02）
导入包 `toolPolicy: ["knowledge.search"]` 通过；`[{"token":"x"}]` 被 Zod 与 DB CHECK 同时拒绝（E1 → `AGENT_STARTER_TOOL_POLICY_INVALID`，附 stableName + 字段路径）。空数组旧包仍可导入。

## UC-3 官方角色包导入（AG03）
`POST /admin/agents/starter-pack-imports` → 签名/摘要（现有）→ 白名单 Workflow 均已注册、skillVersions 均存在且 verified → 每组织 4 个 `official` 草稿。
- A1：导入新版本生成新草稿；已发布版本与在跑 run 钉旧版本。
- A2：克隆官方 → `org`，无官方徽标。
- E2：`UNRESOLVED_WORKFLOW_REF` / `UNRESOLVED_SKILL_REF`，列 missingIds，事务回滚无新增行。

## UC-4 目录与角色区块（AG04）
成员 `listAgentDirectory`（可 `roleCategory`、`q`）→ 分组卡片 → 「开始对话」。管理员 `getAgentRoleAdmin` 看就绪性清单，逐项授权（写分类显式）。
- A3：avatar 空/未知 key → 首字母。
- E9：无权 → 不列；`getAgentDirectoryCard` 直链 404。
- 授权查询失败 → `readiness=unknown`，不整页报错。

## UC-5 Workflow 白名单（AG05）
Agent 请求 W → Runtime 读 run 钉住快照 `workflowAllowlist` → 命中创建实例（Skill 版本 Workflow 固定）；未命中 `workflow_not_allowed`（`workflow-runtime.ts`），聊天显示「该角色不能发起此流程」，写审计。
- A4：分诊复述后改选 Workflow 仍校验。
- E4：分类未授权 → effect-gateway 拒绝，run `blocked_capability`，不换供应商。

## UC-6 escalate（AG06）
Agent 命中 `escalationPolicy` → `escalate` 中断（`EscalatePayload`）→ pending → 目标人 `decideEscalation` resolve/reject → decision-guard 校验 → 恢复。
- E6：非目标人 `ESCALATION_DECIDER_FORBIDDEN`；错形载荷 `INTERRUPT_KIND_MISMATCH`。
- E7：超时保持 pending。

## UC-7 handoff（AG07）
Agent `request-handoff{targetRole, packet}` → 校验目标与深度 → 发起人 `confirmHandoff` → 接收方新线程，以发起人身份重读 `evidenceRefs`。`cancelHandoff` 取消。
- E5：`HANDOFF_NOT_ALLOWED` + `HandoffNotAllowedReason`，原线程继续。
- E8：无权引用显示「无法展示此来源」。

## 统一失败枚举
`AgentRoleErrorCode` ∪ `AgentRoleImportError` ∪ `WorkflowErrorCode.workflow_not_allowed`（不重复声明）。
