# 契约束 `agent-role` — 领域模型与不变量（支撑材料）

## 一、现状核实（均已读源码）

- `apps/api/src/domain/agent/version-snapshot.ts`：`SNAPSHOT_FROZEN_FIELDS` = `name, initials, role, roleLabel, instructions, visibility, modelId, skillMounts, toolWhitelist, concurrencyLimit, degradePolicy`；`SNAPSHOT_EXCLUDED_FIELDS` = `agentId, orgId, publishState, cloneFrom, source, roleLabelNeedsConfirmation`；两者都 `satisfies readonly (keyof AgentDefinition)[]`。
- `apps/api/src/domain/agent/definition.ts`：`AgentDefinition` 由 `@repo/contracts` `agentRuntime` 推导，不重述枚举。
- `packages/contracts/src/wave2-runtime.ts`：`AgentStarterPackEntry.toolPolicy: z.array(z.never()).max(0)`；`AgentStarterImportError` 7 个码；`importAgentStarterPack` = `POST /admin/agents/starter-pack-imports`。
- `packages/contracts/src/agent-interrupts.ts`：`AgentInterruptKind = ["confirm_intent","fill_params","choose_option"]`，`AGENT_INTERRUPT_KIND_TO_TOOL_NAME` 按 kind 派生工具名。
- `packages/contracts/src/interview-expert-avatar.ts`：封闭 `AVATAR_KEYS`（`person-1..24`, `robot`）→ 本束 `AgentAvatar.key` 复用。
- `packages/contracts/src/workflow-runtime.ts`：`WorkflowErrorCode` 已含 `workflow_not_allowed`（403，E6 注释即 Agent 不在 `workflowAllowlist`）→ 本束不另立。
- `apps/api/src/domain/agent/call-chain.ts`：`CALL_CHAIN_MAX_DEPTH`（现值 2）。
- `apps/web/components/ui/avatar.tsx` 仅首字母；`apps/web/app/agent/` 不存在。

## 二、概念

- **Agent（=DigitalHuman）**：沿用 `agents`/`agent_versions`，**无新实体**。
- **AgentRoleFields**（值对象，随版本冻结）：`avatar, roleCategory, catalogSource, workflowAllowlist, delegationPolicy, escalationPolicy, kpi`。
- **StarterPackToolPolicy**：能力分类声明（`CapabilityCategory[]`），不是授权。
- **CapabilityReadiness**（派生值）：`toolPolicy × 组织已授权且启用工具的分类` → ready / missing / unknown。
- **EscalateInterrupt**：`AgentInterruptKind` 新成员 `escalate`，载荷 `EscalatePayload`。
- **Handoff**（聚合，状态 `requested → confirmed | cancelled | rejected`）：`HandoffPacket` + `targetRole` + 深度。

## 三、不变量

| # | 不变量 | 出处 |
|---|---|---|
| I-1 | 不建 DigitalHuman 表/实体/第二条版本链；角色字段只在 `agent_versions` | ADR-116 #3 |
| I-2 | `AGENT_ROLE_FROZEN_FIELDS` ⊆ `SNAPSHOT_FROZEN_FIELDS`；已发布快照不因草稿修改而变 | ADR-116 #3，R7 |
| I-3 | 运行时一律读 run 钉住的版本快照，不读草稿 | R7，ADR-118 #5 |
| I-4 | 旧行回填 = `AGENT_ROLE_FIELD_DEFAULTS`（`catalogSource='org'`、`workflowAllowlist=[]`、avatar null） | R3.1，R9 |
| I-5 | `toolPolicy` 只允许能力分类字符串；不携带凭证/token/供应商 ID；DB CHECK 与 Zod 同判 | ADR-120 #1/#2 |
| I-6 | `toolPolicy` 永不产生授权；写分类默认不授予、不继承 | ADR-120 #2 |
| I-7 | 官方包白名单与 skillVersions 以组合矩阵为唯一事实源（`lint:work-stack-graph`）；引用须全部可解析且 Skill 为 verified，否则整包回滚 | ADR-116 #2，ADR-119 #4，E1/E2 |
| I-8 | `catalogSource='official'` 只能由导入端点写；官方版本白名单/策略组织侧不可改；克隆结果恒 `org` 且无官方徽标 | R5，A2 |
| I-9 | Workflow 白名单：命中才创建实例；未命中 `workflow_not_allowed`、不创建、不改走其它 Workflow、写审计 | ADR-118 #9，E3 |
| I-10 | Workflow 固定的 Skill 版本不要求 Agent 挂载；Agent 挂载只管聊天直调 | ADR-118 #9 |
| I-11 | 能力被拒 → `blocked_capability`，不得用同分类其他供应商重试 | ADR-120 #3，E4 |
| I-12 | escalate：决策人须为 policy 目标；kind 不符 `INTERRUPT_KIND_MISMATCH`；超时保持 pending，永不自动批准 | R7，E6/E7 |
| I-13 | handoff：`targetRole ∈ allowedTargets` 且深度 ≤ `maxDepth` ≤ `CALL_CHAIN_MAX_DEPTH`；包内只有引用不含摘录；接收方以发起人身份重读，无权 → 「无法展示此来源」 | ADR-118 #6，E5/E8 |
| I-14 | 目录只列已发布且 visibility 覆盖调用者的 Agent；否则 404（不泄露存在性）；实时呈现层不得绕过白名单 | R5/E9，ADR-121 #2 |

## 四、洋葱落点

- domain：`version-snapshot.ts` 追加字段；白名单判定纯函数；handoff 深度/目标校验；escalate 决策人判定。
- application：starter-pack 导入扩展（引用解析 port：`WorkflowDefinitionStore`、`SkillCatalogRepository`）；目录查询；`decision-guard` 扩 kind；handoff 用例。
- infrastructure：迁移（`agent_versions` 加列 + 回填；`tool_policy` CHECK 替换）、PG 仓储、审计 sink。
- web：`avatar.tsx` 扩 illustration；`/agent` 目录页；`admin/agent/[id]` 角色区块；聊天 escalate/handoff 卡片。
