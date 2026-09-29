# Agent 角色扩展与官方角色包（能力域 agent-role）

> 元数据：估点 **34**（agent_versions 冻结字段迁移 + 快照/克隆/发布审核接入 6 · starter-pack toolPolicy 放宽为能力分类 + DB CHECK 迁移 5 · 官方角色包（D002/D003/D005/D011）按组织导入 5 · 头像组件 + Agent 目录 UI 7 · Workflow 白名单执行 4 · 委派/转交（handoff）4 · `escalate` 中断 kind 3；与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。
> 实现轮次：`docs/proposals/WORK-STACK-PHASE1-IMPL.plan.md` 第 5 轮（Agent 扩展 + 官方角色包 + 目录 UI）与第 10 轮（角色转交收口）。第 5 轮验收：4 个官方角色在目录中带头像/分类可见，D002 发起白名单外 Workflow 得到可见失败；第 10 轮验收：D002 → D017/D040 等转交包可被接收方以自身权限重读。
> 依据：ADR-116（Agent 即 DigitalHuman，第 3 条：角色能力作为 `agent_versions` 冻结字段）、ADR-118（第 6 条 effect-gateway 权限重查、第 9 条 Workflow 固定 Skill 版本，Agent 不为 Workflow 另挂 Skill）、ADR-119（G0–G5 门）、ADR-120（第 1/2/3 条：能力分类、starter-pack toolPolicy 放宽、拒绝后不换供应商重试）、`docs/proposals/PROP-WORK-STACK-001.md` 修订 R1（头像先用插画 key 集占位）、`requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 第 8/9/11/17 行、实体文档 `requirements/work-stack-v2/digital-humans/{D002-research-knowledge-analyst,D003-product-manager,D005-sales-representative,D011-design-thinking-expert}.md`、`requirements/work-stack-v2/realtime-digital-human/CONTRACT.md` §11（`request-handoff`）。

## 现状核实（本文所有"已有"论断的出处）
- 版本快照：`apps/api/src/domain/agent/version-snapshot.ts` 的 `SNAPSHOT_FROZEN_FIELDS` 目前为 `name, initials, role, roleLabel, instructions, visibility, modelId, skillMounts, toolWhitelist, concurrencyLimit, degradePolicy`；`SNAPSHOT_EXCLUDED_FIELDS` 含 `publishState, cloneFrom, source, roleLabelNeedsConfirmation`。文件注释写明该列表是 load-bearing（快照按它复制字段）——新字段必须加进这张表才会被冻结。
- 头像：`apps/web/components/ui/avatar.tsx` 现仅基于首字母（`initials`），无图像/插画 key。
- starter-pack：`packages/contracts/src/wave2-runtime.ts` 中 `AgentStarterPackEntry.toolPolicy: z.array(z.never()).max(0)`；迁移 `apps/api/migrations/20260804150000_wave2_agent_starter_import.sql` 第 31 行 `tool_policy jsonb NOT NULL CHECK (jsonb_typeof(tool_policy)='array' AND jsonb_array_length(tool_policy)=0)`。两处都强制为空，带工具的角色 Agent 无法经包分发（PROP §1 "Agent" 行）。
- 中断：`packages/contracts/src/agent-interrupts.ts` 第 65 行 `AgentInterruptKind = z.enum(["confirm_intent","fill_params","choose_option"])`，`AGENT_INTERRUPT_KIND_TO_TOOL_NAME` 按 kind 派生工具名；`apps/api/src/application/agent-interrupts/decision-guard.ts` 按 kind 比对并返回 `INTERRUPT_KIND_MISMATCH` 等错误码。**尚无** `escalate` kind。
- Web：Agent 只有管理详情页 `apps/web/app/admin/agent/[id]/page.tsx`、`apps/web/app/platform-admin/agent/[id]/page.tsx`，**没有**面向成员的 Agent 目录页。
- 工作流白名单、委派/升级策略、KPI、`roleCategory`、`catalogSource` 在基线代码中均不存在（D002 文档 §2.1 亦标注 `workflowAllowlist` 为 proposed-unwired）。

## R1 概览
- **Use Case 名称**：把 4 个官方角色（D002/D003/D005/D011）作为带头像、分类、Workflow 白名单、委派/升级策略与 KPI 的 Agent 版本导入组织，成员可在目录中发现并使用；角色只能发起白名单内 Workflow，超出权限时以 `escalate` 中断交人或经 handoff 交给其他角色。
- **Actor**：
  - 组织管理员（导入官方角色包、授予能力分类对应的工具授权、发布/停用 Agent、编辑组织自建 Agent 的角色字段）；
  - 平台运营（维护官方角色包内容与版本）；
  - 组织成员（浏览 Agent 目录、与角色对话、处理 `escalate` 中断、接收 handoff）；
  - 系统 Actor：Workflow Runtime（第 3 轮，校验白名单）、effect-gateway（ADR-118 #6，重查权限）、Agent 发布审核流程。
- **目标**：Agent 即数字人（ADR-116 #3），不引入 DigitalHuman 实体；角色能力随 Agent 版本快照冻结，历史 run 能答出"当时这个角色可发起哪些 Workflow、可委派给谁"。
- **系统边界**：`packages/contracts`（AgentDefinition 新字段 Zod、starter-pack 契约、`AgentInterruptKind`）、`apps/api` agent 域/应用层/迁移、starter-pack 导入、agent-interrupts、`apps/web` 头像组件与 Agent 目录页。不含：Workflow Runtime 本体（第 3 轮）、MCP 工具打分类（ADR-120 实现）、KPI 统计计算与看板（第 10 轮 Board 投影只读取）、实时语音（ADR-121，独立 phase）。

## R2 前置与触发
- **前置条件**：
  - 第 2 轮 `skill_catalog_entries` 与 WorkSkillManifest 已落地（官方角色包的 `skillVersions` 引用可解析）；
  - 第 3 轮 Workflow 定义注册表已可按 `W001` 等 stableId 查询（白名单校验的引用目标）；
  - 实体文档 D002/D003/D005/D011 评审为 PASS（修订 R1）；
  - 导入者为组织管理员。
- **触发条件**：
  - 管理员调用 `POST /admin/agents/starter-pack-imports` 导入官方角色包（沿用现有 Agent starter-pack 管线）；
  - 管理员新建/编辑 Agent 草稿并发布新版本；
  - 成员打开 Agent 目录页；
  - Agent（聊天中或经 `request-workflow`）请求发起某 Workflow；
  - Agent 判定事项属于 must-escalate（如 D002 文档 §4 表第四列）或需交给其他角色（`request-handoff`）。

## R3 主流程
1. **字段契约**：在 `AgentDefinition` 增加 `avatar{kind:"illustration", key}`（key 取自固定插画 key 集，修订 R1）、`roleCategory`（枚举，如 `research|product|sales|design|…`）、`catalogSource`（`official|org`）、`workflowAllowlist: string[]`（Workflow stableId，如 `W001`）、`delegationPolicy{allowedTargets: AgentRoleRef[], maxDepth}`、`escalationPolicy{rules:[{matter, target:"requester"|"project_owner"|"org_admin"}]}`、`kpi[]`（指标 key + 描述，只声明不计算）。全部加入 `SNAPSHOT_FROZEN_FIELDS`；迁移给 `agent_versions` 加对应列，旧行回填默认值（`avatar` 空→前端回退首字母、`catalogSource='org'`、`workflowAllowlist=[]`）。
2. **toolPolicy 放宽**：`AgentStarterPackEntry.toolPolicy` 改为 `z.array(CapabilityCategory)`（ADR-120 #2，只允许能力分类字符串如 `knowledge.search`、`crm.read`，不允许凭证、token、供应商 ID）；新迁移删除旧 CHECK，替换为"数组且每项为符合分类格式的字符串"的 CHECK。
3. **官方角色包导入**：平台运营产出 `skills/starter-packs/` 下的官方角色包，每个条目的 `workflowAllowlist` 与 `skillVersions` 逐字取自 `DIGITALHUMAN-COMPOSITION-MATRIX.md`（D002 = W001/W060/W009/W006/W057 + 10 个 Skill；D003、D005、D011 同理，见矩阵第 9/11/17 行）。管理员导入 → 系统校验签名/摘要（现有流程）+ 白名单引用的 Workflow 均已注册 + 直接挂载 Skill 均在目录中 → 每组织创建 4 个 `catalogSource='official'` 的 Agent 草稿版本，`toolPolicy` 中的分类**不产生任何授权**。
4. **授权**：管理员在 Agent 详情页看到"能力分类就绪性"清单（分类 → 本组织已授权工具/缺失），逐项授予；默认只读，写分类（`*.write`、`mail.send`）需显式授权，不从包继承（ADR-120 #2）。
5. **发布**：管理员发布 → 走现有发布审核 → 生成不可变版本快照（含第 1 步全部新字段）。
6. **目录**：成员打开 Agent 目录页 → 按 `roleCategory` 分组展示卡片（头像、名称、`roleLabel`、官方徽标、可发起的 Workflow 名称列表、能力就绪状态），可筛选分类、搜索名称 → 点击"开始对话"进入聊天。
7. **白名单执行**：Agent 请求发起 Workflow W → Workflow Runtime 读取当前 run 绑定的 Agent 版本快照 `workflowAllowlist` → 命中则创建 Workflow 实例（Skill 版本由 Workflow 固定，Agent 无需挂载，ADR-118 #9）；未命中则返回 `WORKFLOW_NOT_ALLOWED`，聊天中可见提示"该角色不能发起此流程"。
8. **升级（escalate）**：Agent 遇到 `escalationPolicy` 命中的事项 → 发出 `escalate` 中断（新 kind，载荷 `{matter, reason, target, contextRefs}`）→ 线程进入 pending，目标人收到通知 → 目标人 `resolve`（给出决定文本）或 `reject` → `decision-guard` 校验 kind 与决策人身份 → run 恢复，Agent 按决定继续。
9. **转交（handoff）**：Agent 发出 `request-handoff{targetRole, packet}`（CONTRACT §11）→ 系统校验 `targetRole ∈ delegationPolicy.allowedTargets` 且调用深度 ≤ `maxDepth`（不超过现有 call-chain 上限 2）→ 交接包只含问题原文、已确认范围、ledger/证据包 ID、未决项（D002 §5），不含摘录全文 → 发起人确认后在接收方 Agent 新开线程；接收方按**发起人**身份重读引用（ADR-118 #6 权限重查）。

## R4 备选流程与异常流程
- **备选流程**：
  - A1：组织已导入同一官方包旧版本 → 导入新版本生成新的 Agent 草稿版本，已发布版本与在跑 run 仍钉住旧版本；管理员手动发布后才切换。
  - A2：管理员克隆官方 Agent → 克隆结果 `catalogSource='org'`，可改白名单/头像等；官方徽标不带过去。
  - A3：`avatar` 为空或 key 不在插画集 → 头像组件回退首字母渲染，不报错。
  - A4：用户在分诊复述后改选 Workflow（D002 决策 2）→ 仍须通过白名单校验。
- **异常流程**：
  - E1：starter-pack `toolPolicy` 含非分类值（凭证、供应商名、对象）→ Zod 拒绝，导入整体失败，返回条目 stableName + 字段路径；DB 不写任何行（事务回滚）。
  - E2：白名单引用未注册 Workflow 或 Skill 版本不存在 → 导入失败，错误码 `UNRESOLVED_WORKFLOW_REF` / `UNRESOLVED_SKILL_REF`，列出缺失 ID。
  - E3：Agent 请求白名单外 Workflow → `WORKFLOW_NOT_ALLOWED`，不创建实例、不静默改走其他 Workflow；聊天可见失败文案，审计日志记录。
  - E4：能力分类未授权 → Workflow 阶段/工具调用经 effect-gateway 被拒，返回缺失分类；不得换同分类其他供应商重试（ADR-120 #3），run 标记 `blocked_capability`。
  - E5：handoff 目标不在 `allowedTargets`、目标角色在本组织未发布或已停用、或深度超限 → `HANDOFF_NOT_ALLOWED`（附原因），原线程继续，提示用户可手动联系人。
  - E6：`escalate` 目标人无权（非项目 owner/非管理员）尝试决策 → `decision-guard` 返回 403 类错误码；对 `escalate` 发 `choose_option` 形状载荷 → `INTERRUPT_KIND_MISMATCH`。
  - E7：`escalate` 超时无人处理 → 保持 pending，不自动批准；run 不释放 lease 以外的资源，目录卡片不受影响。
  - E8：接收方重读引用时发起人无权读 → 该引用在接收方显示"无法展示此来源"，不传递内容（D002 决策 6 fail closed）。
  - E9：成员无权使用某 Agent（visibility 不含其范围）→ 目录中不显示该卡片，直接 URL 访问返回 404。

## R5 权限与可见性
- 组织管理员：导入官方角色包、授予能力分类授权、发布/停用 Agent、编辑 `catalogSource='org'` Agent 的全部角色字段；**不能**编辑官方 Agent 版本的白名单/策略（只能克隆后改）。
- 平台运营（platform-admin）：维护官方包内容与版本；**不能**替组织授予工具授权或发布组织内 Agent。
- 组织成员：只读目录中 visibility 覆盖自己的已发布 Agent；可与之对话、确认 handoff、在被指定为 target 时处理 `escalate`；**不能**查看未发布草稿、修改任何角色字段、看到能力授权详情（只看到"可用/能力未就绪"）。
- 项目 owner：处理 `escalationPolicy.target='project_owner'` 的中断，仅限其项目范围。
- Agent 自身（系统 Actor）：只能发起白名单内 Workflow、只能转交给 `allowedTargets`；所有外部副作用经 effect-gateway 以发起人权限执行。
- 外部访客/未登录用户：不可访问目录或任何 Agent。

## R6 后置条件 / 不包含
- **后置条件**：每个导入组织拥有 4 个官方角色 Agent；已发布版本快照含全部新冻结字段；`tool_policy` CHECK 已替换；审计日志记录每次白名单拒绝、escalate、handoff。
- **不包含**：KPI 的采集与计算（仅声明，第 10 轮 Board 投影读取）；头像 AI 出图（修订 R1 未定，先用插画 key 集）；实时语音数字人（ADR-121 独立 phase）；其余 56 个 D 角色（后续 Stage）；MCP 工具分类打标本身。

## R7 业务规则
- Agent 即 DigitalHuman：不建 DigitalHuman 表或第二条版本链（ADR-116 #3）。
- 新角色字段一律冻结；运行时一律读 run 钉住的版本快照，不读 Agent 当前草稿。
- 包里的 `toolPolicy` 只是能力分类声明，永不携带授权；写权限不继承（ADR-120 #2）。
- Workflow 使用的 Skill 由 Workflow 固定版本，Agent 不为 Workflow 另挂 Skill；Agent 在聊天中不能直接调用未挂载 Skill（ADR-118 #9，D002 §2.1）。
- handoff 包不含来源摘录全文；接收方以发起人权限重读。
- must-escalate 事项不得由 Agent 自行决定，`escalate` 不得自动超时批准。
- 官方包 `workflowAllowlist`/`skillVersions` 必须与组合矩阵一致（单一事实源），由 `lint:work-stack-graph` 核对，不在包内另写一份手工清单。

## R8 界面线索
- 前端入口：新增成员可见的 Agent 目录页（建议 `apps/web/app/agent/page.tsx`，与 `/skill` 平行）；管理详情页 `apps/web/app/admin/agent/[id]/page.tsx` 增加"角色"区块（头像选择、分类、白名单只读/可编辑、委派/升级策略、能力就绪性清单）；聊天中新增 `escalate` 中断卡片（事项、原因、决定输入框、批准/驳回）与 handoff 确认卡片（目标角色头像 + 交接包摘要 + 确认/取消）。
- 头像组件：扩展 `apps/web/components/ui/avatar.tsx`，支持 `illustration` key，回退首字母。
- 线框：待 UI 先行阶段产出（`../ui-preview/`），随契约束 `contracts/agent-role/` 签核。
- 提醒：开工前 UI 须随契约束经人类签核（束级 `design-signoff.md` 第 ① 节，ADR-023）；本阶段人类已授权签核前先行开发，签核状态保持 pending 由人类补签。

## R9 非功能约束
- 性能/规模：目录页首屏 P95 < 500ms（单组织 ≤200 个 Agent）；白名单校验为内存集合查找，不额外查库。
- 安全/隐私：包导入拒绝任何凭证形态；escalate/handoff/白名单拒绝全部写审计；handoff 包不含原文摘录。
- 兼容与降级：旧 agent_versions 行回填默认值后行为不变；旧版 starter-pack（空 toolPolicy）仍可导入；头像缺失回退首字母。

## R10 已知约束 / 依赖
- 依赖：第 2 轮 Skill 目录、第 3 轮 Workflow 注册表与 Runtime、第 4 轮 effect-gateway/HITL；ADR-120 能力分类枚举；现有 Agent starter-pack 导入管线与发布审核；agent-interrupts 契约与 `decision-guard`。
- 技术约束：PostgreSQL 迁移（新列 + 替换 CHECK）；Zod 契约单源（`packages/contracts`）；`AGENT_INTERRUPT_KIND_TO_TOOL_NAME` 必须同步增加 `escalate` 映射，不两处手写。

## R11 切分提示
- 建议 feature（按依赖序）：①冻结字段契约 + 迁移 + 快照（6）→ ②toolPolicy 放宽 + CHECK 迁移（5）→ ③官方角色包内容 + 导入（5）→ ④头像组件 + 目录 UI + 管理详情角色区块（7）→ ⑤白名单执行（4，依赖第 3 轮）→ ⑥`escalate` 中断 kind（3，依赖第 4 轮 HITL）→ ⑦handoff（4，第 10 轮）。
- ①② 可并行；③ 依赖 ①② 与第 2 轮；⑦ 放第 10 轮收口。

## R12 AI Ready 验收线索
- 成功态：导入官方包后组织内出现 4 个 `catalogSource='official'` Agent；发布后版本快照 JSON 含 `avatar/roleCategory/catalogSource/workflowAllowlist/delegationPolicy/escalationPolicy/kpi`；修改草稿不影响已发布快照。
- 迁移态：`agent_starter_pack` 相关表的 `tool_policy` 可写入 `["knowledge.search"]`，写入 `[{"token":"x"}]` 被 CHECK 拒绝。
- 目录态：成员访问目录页按分类看到 4 张卡片，含插画头像与官方徽标；无 avatar 的 Agent 显示首字母。
- E1/E2：非法 toolPolicy 或未解析引用导入返回对应错误码且 DB 无新增行。
- E3：D002 请求 W027 返回 `WORKFLOW_NOT_ALLOWED`，无 Workflow 实例生成；请求 W001 成功创建实例。
- E4：未授权 `crm.read` 时 D005 的相关阶段返回 `blocked_capability`，日志无其他供应商重试。
- E5/E9：D002 转交给未在 `allowedTargets` 的角色返回 `HANDOFF_NOT_ALLOWED`；无权成员看不到卡片且直链 404。
- E6/E7：非目标人决策 escalate 被拒；错形载荷得 `INTERRUPT_KIND_MISMATCH`；超时后仍 pending。
- E8：handoff 后接收方对发起人无权读的引用显示"无法展示此来源"。
- 权限态：普通成员调用管理写接口 403；平台运营无法为组织授予工具授权；官方 Agent 的白名单在组织管理员侧不可编辑。
