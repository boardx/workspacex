# 契约束 `agent-role` — 覆盖矩阵（支撑材料）

R12 线索 → API operation（`packages/contracts/src/agent-role.ts` 除另注）→ 前端消费点。

## 一、R12 → operation → 前端

| 行键 | R12 线索 | feature | API 操作 / 契约符号 | 前端消费点 |
|---|---|---|---|---|
| V1 | 成功态：导入后 4 个 `official` Agent | AG03 | `importAgentStarterPack`（wave2-runtime，追加 `AgentRoleImportError`）+ `AgentRolePackEntryExtension` | 管理 Agent 列表（既有） |
| V2 | 成功态：快照含 7 字段；改草稿不影响已发布 | AG01 | `AgentRoleFields`、`AGENT_ROLE_FROZEN_FIELDS`、`updateAgentRoleDraft` | `admin/agent/[id]` 角色区块 |
| V3 | 迁移态：`["knowledge.search"]` 过、`[{"token":"x"}]` 拒 | AG02 | `StarterPackToolPolicy`（DB CHECK 同判） | 无（后端） |
| V4 | 目录态：分组 4 卡、插画头像、官方徽标、首字母回退 | AG04 | `listAgentDirectory`、`AgentDirectoryCard`、`AgentAvatar` | `/agent` 目录页、`avatar.tsx` |
| V5 | E1/E2：非法 toolPolicy / 未解析引用，DB 无新增 | AG02/AG03 | `AgentRoleImportError`、`AgentRoleImportFailureDetail` | 管理导入结果提示（既有） |
| V6 | E3：D002→W027 拒、W001 成功 | AG05 | Runtime 启动实例 + `WorkflowErrorCode.workflow_not_allowed`（workflow-runtime.ts） | 聊天失败文案 |
| V7 | E4：未授权 `crm.read` → `blocked_capability`、不换供应商 | AG05（依赖 WF effect-gateway） | workflow-runtime 契约（本束不重述）；就绪性 `getAgentRoleAdmin.capabilityReadiness` | 角色区块就绪清单、运行面板 |
| V8 | E5：目标不在 allowedTargets → `HANDOFF_NOT_ALLOWED` | AG07 | `confirmHandoff`、`HandoffNotAllowedReason` | handoff 确认卡片 |
| V9 | E9：无权不见卡片、直链 404 | AG04 | `listAgentDirectory`、`getAgentDirectoryCard`（`AGENT_NOT_FOUND`） | 目录页 / 404 |
| V10 | E6：非目标人被拒；错形载荷 `INTERRUPT_KIND_MISMATCH` | AG06 | `decideEscalation`、`EscalateDecision`、`EscalatePayload` | escalate 卡片 |
| V11 | E7：超时仍 pending | AG06 | 无 operation（无自动决策路径即证明） | escalate 卡片保持待处理 |
| V12 | E8：无权引用「无法展示此来源」 | AG07 | `HandoffPacket.evidenceRefs`（只引用）+ 发起人身份重读 | 接收方线程引用渲染 |
| V13 | 权限态：成员写 403；平台运营不能授权；官方白名单不可改 | AG01/AG04 | `ROLE_INSUFFICIENT`、`OFFICIAL_ROLE_FIELDS_LOCKED`、`getAgentRoleAdmin.editable` | 角色区块只读态 |

## 二、operation → 前端反查（无孤儿）

| operation | 消费点 |
|---|---|
| `listAgentDirectory` / `getAgentDirectoryCard` | `/agent` 目录页 |
| `getAgentRoleAdmin` / `updateAgentRoleDraft` | `admin/agent/[id]` 角色区块 |
| `decideEscalation` | 聊天 escalate 卡片 |
| `confirmHandoff` / `cancelHandoff` | 聊天 handoff 卡片 |

## 三、UC 覆盖

UC-1→AG01，UC-2→AG02，UC-3→AG03，UC-4→AG04，UC-5→AG05，UC-6→AG06，UC-7→AG07。

## 四、开放问题（待签核人裁决）

- **Q1 `CapabilityCategory` 两份定义**：`work-skill-meta.ts` 正则 `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$` 与 `workflow-runtime.ts` `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$` 不一致（连字符 vs 下划线）。本束 import 前者；须收敛为单源。
- **Q2 `roleCategory` 枚举**：requirements R3 `research|product|sales|design|…` vs PROP §4.3 `enterprise-general|method-expert|industry-expert|professional-role|deep-professional`。草案用前者 + `general`。
- **Q3 白名单粒度**：PROP 说「固定到 Workflow 版本」，requirements/R12 用 stableId（`W001`）。草案存 stableId、版本由 Runtime 解析；是否需 `W001@v` 形式？
- **Q4 `escalationPolicy` 形状**：PROP `{triggers, target}` vs requirements `{rules:[{matter,target}]}`；草案取后者。`delegationPolicy.requireApproval`（PROP 有、requirements 无）草案保留，默认 true。
- **Q5 escalate 工具名** `escalate_matter` 与决策端点路径 `/agent-interrupts/:id/escalation-decision` 是否并入既有中断决策端点。
- **Q6 目录路由** `/agent` 新顶层 vs `/skill` 式 `?screen=`；以及 UI 缺图（escalate/handoff/管理区块）是否须在签核前补。
- **Q7 头像 key 集**：复用 `interview-expert-avatar.ts` 的 `person-1..24/robot`，还是为角色另起插画集。
