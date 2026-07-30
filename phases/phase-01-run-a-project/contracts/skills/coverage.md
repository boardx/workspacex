# 契约束 `skills` — 支撑材料②：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：**F61 F62 F63 F64 F65 F66 F67 F68**（31 点）
> ⚠ **这一行是派生视图，不是权威。** 束↔feature 映射的权威是 `design-signoff.md` frontmatter
> 的 `covers:`（ADR-023 决策三）。改覆盖范围改那里，不要改这一行。
>
> 验收线索来源：六份 UC 的 R12 合计 **77 条**
> （uc-3-1: 16 · uc-3-2: 14 · uc-3-3: 9 · uc-3-4: 11 · uc-3-5: 13 · uc-3-6: 14）。

## 怎么读这些表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由（已在仓库中核实）；
填不出来的标 `—（API 层验收）` 或标出未建，**但不能空着**。

已建成并可引用的三块屏：
`/admin/skill`（`apps/web/components/admin/skill-screen.tsx`）·
`/admin/feedback`（`feedback-screen.tsx`）·
`/chat` 输入区与 AI 消息（`chat/composer.tsx` · `composer-settings.tsx` · `ai-message.tsx`）·
`/projects/[id]/canvas` 左栏（`canvas/canvas-left-panel.tsx`）。

---

## 一、uc-3-1 上传并校验一个 Skill（R12 共 16 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：任一已启用 skill 都能看到输入输出契约与最近一次试跑结果 | `getSkillDetail` → `contract` + `latestTrialRun` | `/admin/skill` `admin-skill-contract-{id}`（契约三段已渲染）；**试跑结果未建** | ⚠ **缺口 1** |
| V2 | AC2：只过安全扫描未过方法论审核停在待审核；直调置已启用被拒并记审计 | `reviewSkillVersion`；越权路径 → `GATE_NOT_PASSED` | `/admin/skill` `admin-skill-status-{id}`（`sk-promote` 为待审核态）；**`[批准发布]`/`[退回]` 未建** | ⚠ **缺口 2** |
| V3 | 提交人尝试批准自己提交的 skill 被拒，提示需另一名审核人 | `reviewSkillVersion` → `SELF_REVIEW_FORBIDDEN` / `NO_SECOND_REVIEWER` | —（API 层验收；审核动作屏未建） | ⚠ **缺口 2** |
| V4 | AC3：「仅某团队」的 skill 对范围外用户在列表/搜索/绑定面板/对话加技能四处不可见 | `listSkills({entry})` 四入口共用同一判定 | `/admin/skill` `admin-skill-visibility-{id}`；`/chat` `chat-settings-skill`；绑定面板屏未建 | ⚠ **缺口 3** |
| V5 | 六类角色遍历，可读数据与可执行动作严格符合 R5 | 全部用例的 `pre` + `SKILL_NOT_FOUND`(404 非 403) | `/admin/skill?as=…` 预览轴 + `denied` 态（`AdminScreen.denialReason` 已写实） | ✅ |
| V6 | 声明读原始转写但未获授权 → 校验失败且不进待审核队列 | `createSkillDraft` → `RAW_TRANSCRIPT_NOT_AUTHORIZED` | `/admin/skill?state=invalid`（`errors.dataScope` 已写实越权文案） | ✅ |
| V7 | 试跑返回不符合 schema 时不入库，给失败原因与可复制日志 | `runTrialRun` → `TRIAL_RUN_SCHEMA_MISMATCH` | **试跑入口未建**（行内动作只有下线/新建/导入） | ⚠ **缺口 1** |
| V8 | 依赖模型被停用时该 skill 载入明确失败，不静默换模型 | `resolveMountedSkills` / `runTrialRun` → `MODEL_UNAVAILABLE` | `/admin/skill?state=dep-failed`（`depFailure` 已写实） | ✅ |
| V9 | 三种来源各造一条，来源标记由系统打标且提交人不可改写 | `createSkillDraft` 忽略入参 `source`；改写 → `SOURCE_TAG_IMMUTABLE` | `/admin/skill` 行内来源徽标（**⚠ 当前 mock 用「手工/方法晋升」二值，与五取值枚举不一致**） | ⚠ **缺口 4** |
| V10 | Skill 库为空时显示真实空态与新建入口，不生成示例数据 | `listSkills` → `[]` | `/admin/skill?state=empty` `emptyHint="Skill 库还是空的"` + `admin-skill-add` | ✅ |
| V11 | 两名维护者同时改同一 skill 不静默覆盖，可识别最终版本 | `publishNewVersion`（`expectedHeadVersion`）→ `SKILL_VERSION_CHANGED` | —（API 层验收） | ✅ 见 domain I-7 |
| V12 | 发布/退回/停用可按操作者/时间/对象/门禁结论检索；越权尝试也有安全审计 | `AuditWriter` + 审计检索面 | **组织级审计检索屏 D-34 未建**（`/admin` 活动流只有 7 条 mock） | ⚠ **缺口 5** |
| V13 | 状态取值集合恰为四态，无「已发布」字面量，`已归档` 不单列 | 枚举断言（domain I-1） | `/admin/skill` `admin-skill-status-{id}`（mock 已是 enabled/review/draft/disabled 四值） | ✅ |
| V14 | 两种审核职能不合并：各自越界裁决被拒；指派只有组织管理员可做 | `reviewSkillVersion` → `REVIEWER_FUNCTION_MISMATCH` | **职能指派屏未建**（`/admin/members` 未含职能授权） | ⚠ **缺口 6** |
| V15 | Context API 唯一通路：skill 读到的上下文全部来自 Context Pack，无直连代码路径 | `ContextApiClient` + 架构依赖规则测试 | —（架构断言，无界面） | ⚠ **缺口 7**（跨束） |
| V16 | 一次调用后 `context_packs` 有对应记录，可重放条目与 anchor/omissions | `ContextApiClient` 落记录 | `/brain` 「AI 读到了什么」（context-pack 束已建） | ⚠ **缺口 7**（跨束） |

## 二、uc-3-2 把 Skill 绑定到环节与角色（R12 共 14 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：从环节 02 推进到 03，挂载的 skill 自动更换并显示「因环节 03 载入」 | `resolveMountedSkills` → `mounts[].reason` | `/projects/demo/canvas` `canvas-skill-{id}`（清单已建，**「因环节载入」说明与自动换未建**） | ⚠ **缺口 8** |
| V2 | AC2：实例级换绑后后台模板本体不变，新项目套用仍是原绑定 | `upsertSegmentBinding(level=instance)`；`TEMPLATE_WRITEBACK_FORBIDDEN` | **`设置 → 工作流编排` 屏未建**（`/projects/[id]` 无 settings 子路由） | ⚠ **缺口 9** |
| V3 | AC3：每个非空角色格生成一条对应角色待办；负责人为人，agent 记执行者 | `generateRoleTodos` | `/tasks`（任务屏已建，**编排 → 待办这条边未建**） | ⚠ **缺口 9** |
| V4 | AC4：组长切环节后三种视角首屏 1 秒内跟着换 | `resolveMountedSkills` + 环节切换事件（templates 束） | `/chat` `/projects/demo/canvas` 首屏（**切换联动未建**） | ⚠ **缺口 8** |
| V5 | AC5：组员在画布左栏可见并可运行，但无增删改入口；直调修改被拒 | `resolveMountedSkills`（只读）；写路径 → `PERMISSION_REVOKED` | `/projects/demo/canvas` `canvas-left-panel` `canvas-skill-{id}-run` / `-on`（**已建、可直接签**） | ✅ |
| V6 | AC6：切模板/删环节列出将丢失的绑定与分工并要求确认，确认前不执行 | `previewOrphanBindings` / `confirmOrphanDisposition` | **未建**（工作流编排屏缺失） | ⚠ **缺口 9** |
| V7 | 绑第 7 个 skill 出现分散注意力提示但保存成功（提示不阻断） | `upsertSegmentBinding` → `warnings[]`（非错误码） | **未建** | ⚠ **缺口 9** |
| V8 | 未被任何环节绑定的 skill 在库里显示为「闲置」 | `listIdleSkills` | `/admin/skill` 行内徽标（**闲置徽标未建**） | ⚠ **缺口 10** |
| V9 | 项目 A 套用 v2 后模板升到 v3，A 现场挂载的仍是 v2 的绑定与 skill 版本 | `applyWorkflowTemplate` 记 `sourceTemplateVersion`；绑定锁 `versionId` | —（API 层验收） | ✅ 见 domain I-9 |
| V10 | `[另存为组织模板]` 生成新的组织级模板，原模板本体不变 | `saveAsOrgTemplate` | **未建** | ⚠ **缺口 9** |
| V11 | 「仅能源组」的 skill 不出现在平台组引导师的绑定池里 | `listSkills({entry:"binding-panel"})` | **绑定面板未建**；判定与 `/admin/skill` `admin-skill-visibility-{id}` 同源 | ⚠ **缺口 3** |
| V12 | 绑定的 skill 停用后进行中项目继续用锁定版本；任务模块不可用时提示 N 条未同步可重试 | `disableSkill` + `generateRoleTodos` → `TODO_SYNC_FAILED` | `/admin/skill` `admin-skill-disable-{id}` + `admin-skill-disable-dialog`（已建）；**「引用了已停用 skill」告警未建** | ⚠ **缺口 11** |
| V13 | 七类角色遍历（含协同引导师），可读与可执行严格符合 R5 | 各用例 `pre`（协同引导师 = 引导师多实例，O-03） | `?as=facilitator\|groupLead\|member\|observer` 预览轴（**协同引导师不在四值内**） | ⚠ **缺口 12** |
| V14 | 绑定增删改、模板切换、另存为可按操作者/时间/项目/模板版本检索 | `AuditWriter` | **审计检索屏未建**（同 uc-3-1 V12） | ⚠ **缺口 5** |

## 三、uc-3-3 在对话里临时加减 Skill（R12 共 9 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：临时加的 skill 在会后复盘被标「临时加载」并可提交回蓝本 | `listThreadDeviations` / `submitMountBackToTemplate` | **复盘屏未建** | ⚠ **缺口 13** |
| V2 | AC2：第 2 组挂载后第 1 组同环节对话挂载列表不变，蓝本不变 | `mountSkillToThread`（作用域 threadId）→ `MOUNT_SCOPE_VIOLATION` | —（API 层验收） | ✅ 见 domain I-18 |
| V3 | AC3：摘掉 skill 后此前生成的消息仍带该 skill 角标 | `unmountSkillFromThread`；归因 append-only | `/chat` `chat-ai-skill`（角标已建、可直接签） | ✅ |
| V4 | 组员端无「＋加技能」入口；直调挂载接口被拒并写安全审计 | `mountSkillToThread` → `MEMBER_CANNOT_SELF_MOUNT` | `/chat?as=member`（**「＋加技能」入口本身未建**，见缺口 14） | ⚠ **缺口 14** |
| V5 | 可选池为空时显示真实空态与原因，不生成示例数据 | `listMountableSkills` → `[]` | **选择器面板未建** | ⚠ **缺口 14** |
| V6 | 某 skill 依赖的模型被停用时在选择器里不可选并说明原因 | `listMountableSkills` → `mountable[].disabledReason` | `/chat` `chat-settings-skill`（**当前是单选 chip 且无禁用态**） | ⚠ **缺口 14** |
| V7 | 五类角色遍历，可读与可执行严格符合 R5 | 各用例 `pre` | `/chat?as=…` 预览轴（观察者已无输入区） | ✅ |
| V8 | 两人同时改同一对话挂载列表不静默覆盖，可识别最终状态 | `mountSkillToThread`（`expectedVersion`）→ `SKILL_VERSION_CHANGED` | —（API 层验收） | ✅ |
| V9 | 挂载/摘除可按操作者/时间/对话/skill 检索；越权尝试有安全审计 | `AuditWriter` | **审计检索屏未建** | ⚠ **缺口 5** |

## 四、uc-3-4 Skill 版本与停用（R12 共 11 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：停用正被进行中项目使用的 skill，该项目行为不变；新建时选不到它 | `disableSkill` + `listSkills` 过滤 | `/admin/skill` `admin-skill-disable-{id}` + `admin-skill-disable-dialog`（立即中断/跑完当前一轮已建） | ✅ |
| V2 | AC2：项目 A 锁 v2 后发布 v3，A 仍解析 v2 契约原文；新项目只能选 v3 | `publishNewVersion`（vN 自动归档）+ 绑定锁版本 | **版本链区块未建**（列表只显示单个 `version` 徽标） | ⚠ **缺口 15** |
| V3 | AC3：对存在任何引用的 skill 硬删被拒并返回引用清单 | `hardDeleteSkill` → `HARD_DELETE_FORBIDDEN`（带清单） | **硬删入口不存在**（正确）；**引用清单展示未建** | ⚠ **缺口 15** |
| V4 | AC4：停用前引用清单含蓝本/进行中项目/agent 三类，空时呈现真实空态 | `listReferences` → 三类数组 | `admin-skill-disable-dialog`（**当前只显示 in-flight 计数，未分三类**） | ⚠ **缺口 15** |
| V5 | 新版本未过方法论审核不生效，vN 保持生效；直接置生效被拒 | `reviewSkillVersion` → `GATE_NOT_PASSED` | —（API 层验收；审核动作屏未建） | ⚠ **缺口 2** |
| V6 | v2 依赖的模型被停用时进行中项目明确失败，不回退 v3 也不换模型 | `resolveMountedSkills` → `MODEL_UNAVAILABLE` | `/admin/skill?state=dep-failed` | ✅ |
| V7 | 对 `CC` 内置 skill 删除被拒，停用允许 | `hardDeleteSkill` → `BUILTIN_NOT_DELETABLE`；`disableSkill` 允许 | `/admin/skill` 行内（**内置徽标与 CC 来源取值未建**，见缺口 4） | ⚠ **缺口 4** |
| V8 | 已停用的 skill 恢复后重进可绑定池，历史引用不受恢复影响 | `restoreSkill` | **`[恢复]` 入口未建**（下线后行内无恢复动作） | ⚠ **缺口 15** |
| V9 | 六类角色遍历，可读与可执行严格符合 R5 | 各用例 `pre` | `/admin/skill?as=…` + `denied` 态 | ✅ |
| V10 | 两名维护者同时改版/停用不静默覆盖，可识别最终状态 | `publishNewVersion` / `disableSkill` → `SKILL_VERSION_CHANGED` | —（API 层验收） | ✅ |
| V11 | 改版/归档/停用/恢复/硬删尝试可按操作者/时间/对象/影响范围检索 | `AuditWriter` | **审计检索屏未建** | ⚠ **缺口 5** |

## 五、uc-3-5 方法晋升生成 Skill（R12 共 13 条）

> ⚠ **本 UC 的触发端在 14-brain（phase-3）。** phase-1 按 R10 处置②**只做接收端**。
> 下表凡属触发端的行，「状态」列标 **⛔ 触发端在 phase-3** ——它不是本轮的缺口，
> 但**必须在签核时被确认**，否则会变成「以为做了」。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：方法类候选批准后 Skill 库出现来源「晋升生成」的 skill，可追回源知识与签字决策 | `receivePromotedSkill` + `getPromotionProvenance` | `/admin/skill`（`sk-promote` 行已有「方法晋升」徽标）；**「来自组织大脑」区块未建** | ⚠ **缺口 16** |
| V2 | AC2：生成的 skill 停在待审核；直调置已启用被拒并记审计 | `receivePromotedSkill` → `status=待审核`；越权 → `GATE_NOT_PASSED` | `/admin/skill` `admin-skill-status-{id}`（`sk-promote` 已是待审核） | ✅ |
| V3 | 无签字决策或复盘未判对的候选晋升被拒，明确指出缺哪一条，且不生成 skill | `receivePromotedSkill` → `PROMOTION_ADMISSION_FAILED` | —（触发端界面在 14-brain） | ⛔ 触发端在 phase-3 |
| V4 | 三项必填缺任一时无法生效，skill 生成一并阻断 | → `PROMOTION_REQUIRED_FIELDS_MISSING` | —（触发端界面在 14-brain） | ⛔ 触发端在 phase-3 |
| V5 | AI 提名并尝试自动入库被服务端拒绝并写安全审计 | → `AI_SELF_PROMOTION_FORBIDDEN` | —（API 层验收） | ✅（接收端可断言） |
| V6 | 非方法类候选晋升不生成 skill | 接收端只接受 `assetType = method` | —（触发端界面在 14-brain） | ⛔ 触发端在 phase-3 |
| V7 | 含客户机密的方法未过脱敏闸门不生成；过闸后只含脱敏稿并可权限门控回溯原文 | → `REDACTION_GATE_REQUIRED`；`redactedOnly` 必为 true | —（脱敏闸门界面在 14-brain） | ⛔ 触发端在 phase-3 |
| V8 | AC3：源知识被推翻 → skill 自动停用且不硬删；进行中项目继续跑完 | `onSourceKnowledgeStateChanged("被推翻")` → `disable` | `/admin/skill` `admin-skill-status-{id}`（已停用态已可渲染） | ✅（接收端可断言） |
| V9 | 源知识被替代 → skill 发新版、旧版归档、已建实例锁旧版 | `onSourceKnowledgeStateChanged("被替代")` → `new-version` | **版本链未建**（同缺口 15） | ⚠ **缺口 15** |
| V10 | AC4：把「晋升生成」改为「自建」被拒 | → `SOURCE_TAG_IMMUTABLE` | —（API 层验收） | ✅ |
| V11 | 模拟 Skill 库不可写：晋升明确失败并给重试入口，不出现「知识已生效但无 skill 也无提示」 | → `DEPENDENCY_UNAVAILABLE` + 回执 | —（回执界面在 14-brain） | ⛔ 触发端在 phase-3 |
| V12 | 七类角色遍历，可读与可执行严格符合 R5 | 各用例 `pre`（含复核负责人职能） | `/admin/skill?as=…`（**复核负责人不在角色枚举内**，同 S-02/S-03） | ⚠ **缺口 12** |
| V13 | 晋升/生成/发布/停用可按操作者/时间/源决策/skill 版本检索 | `AuditWriter` + `getPromotionProvenance` | **审计检索屏未建** | ⚠ **缺口 5** |

## 六、uc-3-6 Skill 改进反馈与版本触发（R12 共 14 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：对一条 AI 消息点 👎，评价可追到 agent、skill 与 skill 版本 | `rateMessage` → `attribution` | `/chat` `chat-ai-message` + `chat-ai-skill`（**👍/👎 控件未建**） | ⚠ **缺口 17** |
| V2 | 9 条同类 👎 聚合成一条带计数与建议文案的条目；👎 数与案例数口径分别标注 | `listSuggestions` → `thumbsDownCount` / `caseCount` | `/admin/feedback` `admin-feedback-agent` + `admin-feedback-agent-{id}`（**案例数第二口径未渲染**） | ⚠ **缺口 18** |
| V3 | AC2：改进提案未经人工复核不上线；直调置生效被拒并记审计 | `reviewProposal` → `PROPOSAL_NOT_REVIEWED` | `/admin/feedback` `admin-feedback-triage-{id}` → `admin-feedback-triaged-{id}`（**复核动作未建**） | ⚠ **缺口 19** |
| V4 | 提交提案的人尝试自行复核被拒，提示需另一名审核人 | `reviewProposal` → `SELF_REVIEW_FORBIDDEN` | —（API 层验收；复核屏未建） | ⚠ **缺口 19** |
| V5 | AC3：满意度可点开看口径与样本量；样本不足显示「样本不足」而非数字 | `getSatisfaction` → `{value,sampleSize}` \| `{insufficient}` | `/admin/skill` 行内「满意度 N%」（**口径/样本量不可点开；`satisfaction=0` 当前被隐藏而非显示「样本不足」**） | ⚠ **缺口 20** |
| V6 | AC4：归类为「实现层缺陷」的条目不出现 `[生成 skill 改进 PR]`，只给软件反馈通道 | `classifySuggestion` + `NOT_CONTRACT_SOLVABLE` | `/admin/feedback` `admin-feedback-software`（**归类徽标未建，按钮对所有条目一视同仁**） | ⚠ **缺口 18** |
| V7 | 复核通过后 vN+1 上线、vN 自动归档，进行中项目仍按锁定版本运行 | `reviewProposal` → `publishNewVersion` 发布路径 | **版本链未建**（同缺口 15） | ⚠ **缺口 15** |
| V8 | 破坏 schema 的改进在复核界面显著标出并列出受影响蓝本与项目 | `reviewProposal` → `SCHEMA_BREAKING_UNACKNOWLEDGED` + `listReferences` | **复核屏与 diff 页未建** | ⚠ **缺口 19** |
| V9 | 缺 skill 版本记录的评价只计 agent 级，不计入满意度，进数据质量报表 | `rateMessage` → `ATTRIBUTION_MISSING` | **数据质量报表未建** | ⚠ **缺口 20** |
| V10 | 原始案例含机密时无权者只见计数与脱敏摘要；提案生成走自托管模型 | `listSuggestionCases`（权限门控）+ 模型路由（20-model） | `/admin/feedback`（**`[看 N 个原始案例]` 未建**） | ⚠ **缺口 18** |
| V11 | 模拟发版失败：提案停在「待上线」可重试且有明确通知 | `reviewProposal` → `RELEASE_FAILED_PENDING` | **「待上线」态未建** | ⚠ **缺口 19** |
| V12 | 六类角色遍历，可读与可执行严格符合 R5 | 各用例 `pre` | `/admin/feedback?as=…` + `denied` 态 | ✅ |
| V13 | 同一人对同一消息重复评价只计一次；异常集中评价被标记且不计入满意度 | `rateMessage` 幂等键 `(messageId, raterId)`；异常检测口径来自 UC-4.4 | —（API 层验收） | ⚠ **缺口 21**（跨束） |
| V14 | 评价/聚合处置/提案生成/复核/上线可按操作者/时间/skill 版本检索 | `AuditWriter` | **审计检索屏未建** | ⚠ **缺口 5** |

---

## 七、缺口清单（这一件的真正价值所在）

> 21 条。**它们是这一轮设计的产出，不是失败**——四件套的意义就是在写代码之前把它们找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **试跑入口与试跑结果整条链不存在**。AC1 逐字要求「每个 skill 都有最近一次试跑结果」，而 `/admin/skill` 行内动作只有下线/新建/导入 | 界面缺口 + 契约可先行 | 由 ui-prototyper 补画（F62 已标 needs_ui_signoff）。API 断言可先做：`runTrialRun` 失败不入库 |
| **2** | **审核动作面（`[批准发布]` / `[退回]`）未建**。双重门禁的**第二道在界面上不存在**，只有一个 `待审核` 徽标 | 界面缺口 | 补画待审核队列 + 两道门禁结论并排显示（安全扫描 ✓ / 方法论审核 ⏳）。API 层 `GATE_NOT_PASSED` / `SELF_REVIEW_FORBIDDEN` 可先断言 |
| **3** | **可见性过滤的「四入口共用同一判定」无处落地**：四个入口里只有 1.5 个已建（库列表、对话侧的单选 chip） | 跨束 + 界面 | ⚠ 提一致性复核：**四入口必须共用同一个服务端判定**，不能各查各的（否则第 N 次「同一事实多处声明」）。绑定面板随缺口 9 一起建 |
| **4** | **来源标记枚举在 mock 里是二值**（`手工` / `方法晋升`），契约要求五取值（`CC/自建/画布/社区/晋升生成`） | **契约与实现已不一致** | 收敛为契约单源（`packages/contracts/src/skills.ts`）并从契约生成 mock；`CC` 取值到位后 V7「内置不可删」才可验 |
| **5** | **组织级审计检索屏（D-34）未建**，而**六份 UC 各有一条「审计态」验收线索**（V12/V14/V9/V11/V13/V14） | 跨束 + 跨阶段 | ⚠ 提一致性复核：**统一一个审计检索面**，不要每束各造一个（与 phase-00 `artifact` 缺口①、`identity` 缺口①同源）。本束只负责写事件 |
| **6** | **两种审核职能的指派动作无落点**：`/admin/members` 没有职能授权面 | 跨束（identity） | 职能授权属组织角色层，应在 `identity` 束定义并在本束消费。提一致性复核 |
| **7** | **Context API 唯一通路（V15/V16）是架构约束，本束只能断言不能实现** | 跨束（context-pack / api-kernel） | 落成依赖规则测试（`lint-arch-deps` 同类）：skill 运行时模块 import 图中不得出现 DB/向量库客户端。提一致性复核确认由谁写这条门控 |
| **8** | **「切环节 → skill 自动换 + 三视角首屏跟着换」联动未建**，且 AC1 那一句本身出自 Backlog（原型未呈现） | 界面缺口 + 需确认 | F64 已标 needs_ui_signoff。事件源 `agenda_segment.switched`（D-03a）在 templates 束，须同步定稿 |
| **9** | **`设置 → 工作流编排` 屏整体未建**：`/projects/[id]` 下只有 canvas / files 两个子路由，没有 settings。而 UC-3.2 的**主载体就是这块屏** | 界面缺口（最大一处） | 补画（F63/F64 的主要交付面）。⚠ UC-3.2 R8 断言「该屏已存在、可直接签」——**那说的是 HTML 原型，不是本仓已建成的 React 屏**，两者不可混为一谈 |
| **10** | **「闲置」徽标未建**（V8） | 界面缺口 | 随 skill 列表补；判定 `listIdleSkills` 可先做 |
| **11** | **「引用了已停用的 skill」告警未建**（V12） | 界面缺口 | 随工作流编排屏补 |
| **12** | **角色枚举装不下本束需要的职能**：协同引导师（O-03 已裁为引导师多实例，但预览轴只有四值）、复核负责人、能力维护者、审核人 | 跨束 + 需裁决 | 与 ui-preview **S-02 / S-03**（合规负责人、研究员/受访者不在枚举里）是**同一个问题的第三、四个面**：组织职能层 vs 项目角色层。建议合并裁决 |
| **13** | **会后复盘屏未建**，UC-3.3 AC1「临时加载被标出来并可提回蓝本」无落点 | 界面缺口 | 复盘归属未定（UC-3.3 R10 明列为待确认）。先建 `listThreadDeviations` API |
| **14** | **「＋加技能」入口与选择器不存在**。已建的 `chat-settings-skill` 是**单选 chip 组**（选一个 skill），而 UC-3.3 要的是**多选的临时挂载列表 + 加/减** —— 两者不是一回事 | 界面缺口 + **已建 UI 与契约语义不符** | F65 已标 needs_ui_signoff。⚠ 签核时请确认：`chat-settings-skill` 是被改造还是并存（并存会产生「两处都能改挂载」的第二事实源） |
| **15** | **版本链、引用清单三栏、`[恢复]`、影响预览全部未建**。当前 `admin-skill-disable-dialog` 只显示 in-flight 计数 | 界面缺口 | F66 已标 needs_ui_signoff。⚠ 但**下线入口本身已建成**（`admin-skill-disable-{id}` + 共享 `DisableDialog`），feature notes 里「停用入口为原型确认缺失」这句**对本仓现状已过期**，签核时请更正 |
| **16** | **skill 详情页「来自组织大脑」区块未建**（V1） | 界面缺口 + 新增设计 | F67 已标 needs_ui_signoff；需产品/设计确认 |
| **17** | **对话消息的 👍/👎 控件不存在**。整个 UC-3.6 的**数据源头缺失**——后台「来自消息级评价」是聚合结果，不能反推采集侧已画 | 界面缺口（承重） | F68 已标 needs_ui_signoff。⚠ 没有它，满意度百分比这个字段**至今无来源**（原型的 94%/91% 是编的） |
| **18** | **聚合项缺三件**：归类徽标、`caseCount` 第二口径、`[看 N 个原始案例]`。现有 `admin-feedback-triage-{id}` 是「分诊并生成改进建议」一个按钮打通到底 | 界面缺口 + 语义不符 | 归类徽标决定按钮出不出现（V6），必须先有。⚠ 现状是**没有归类就直接生成**，与 AC4 相反 |
| **19** | **改进提案 diff 页、人工复核界面、「待上线」态全部未建** | 界面缺口 | F68 已标 needs_ui_signoff。API 层 `PROPOSAL_NOT_REVIEWED` / `SELF_REVIEW_FORBIDDEN` / `RELEASE_FAILED_PENDING` 可先断言 |
| **20** | **满意度的口径、样本量、数据质量报表都无落点**；且**最小样本量 10 / 浮现阈值 3 是「规则已定、数值待产品确认」** | 需数值 + 单源风险 | ⚠ 落点是 `packages/contracts/src/thresholds.ts` 的待定阈值登记表（已有该机制），**不要在本束或 mock 里写死 10 和 3**。ui-preview **S-04** 已记录过一次「编造 sampleSize=18」的事故 |
| **21** | **防刷判据来自 UC-4.4（04-agent）**，本束只消费不定义 | 跨束 | 提一致性复核：异常评价检测口径必须只有一份 |

---

## 八、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `createSkillDraft` / `importSkillContract` | uc-3-1 R3 步骤1 · V6 V9 V10 | ✅ |
| `runSecurityScan` | uc-3-1 V2（门禁第一道） | ✅ |
| `runTrialRun` | uc-3-1 V1 V7 | ✅ |
| `submitForReview` / `reviewSkillVersion` | uc-3-1 V2 V3 V14；uc-3-4 V5 | ✅ |
| `listSkills` | uc-3-1 V4 V10；uc-3-2 V11；uc-3-3 V5 | ✅ |
| `getSkillDetail` | uc-3-1 V1；uc-3-5 V1 | ✅ |
| `applyWorkflowTemplate` | uc-3-2 V2 V6 V9 | ✅ |
| `upsertSegmentBinding` | uc-3-2 V2 V7 V11 | ✅ |
| `saveAsOrgTemplate` | uc-3-2 V10；uc-3-3 A3 | ✅ |
| `previewOrphanBindings` / `confirmOrphanDisposition` | uc-3-2 V6 | ✅ |
| `generateRoleTodos` | uc-3-2 V3 V12 | ✅ |
| `resolveMountedSkills` | uc-3-2 V1 V4 V5；uc-3-4 V6 | ✅ |
| `listIdleSkills` | uc-3-2 V8 | ✅ |
| `listMountableSkills` | uc-3-3 V5 V6 | ✅ |
| `mountSkillToThread` / `unmountSkillFromThread` | uc-3-3 V2 V3 V4 V8 | ✅ |
| `listThreadDeviations` / `submitMountBackToTemplate` | uc-3-3 V1 | ✅ |
| `publishNewVersion` | uc-3-4 V2 V10；uc-3-6 V7 | ✅ |
| `listReferences` | uc-3-4 V3 V4；uc-3-6 V8 | ✅ |
| `disableSkill` / `restoreSkill` | uc-3-4 V1 V8；uc-3-5 V8 | ✅ |
| `hardDeleteSkill` | uc-3-4 V3 V7 | ✅（只有失败出口，仍是必要的门） |
| `upgradeBindingToVersion` | uc-3-4 R3 分支A 第4步（显式升级） | ✅ |
| `receivePromotedSkill` | uc-3-5 V1 V2 V5 V10 | ✅ |
| `getPromotionProvenance` / `linkKnowledgeToSkill` | uc-3-5 V1 V13 | ✅ |
| `onSourceKnowledgeStateChanged` | uc-3-5 V8 V9 | ✅ |
| `listPromotedSkills` | uc-3-5 R9（按来源筛出全部晋升生成） | ✅ |
| `rateMessage` | uc-3-6 V1 V9 V13 | ✅ |
| `getSatisfaction` | uc-3-1 V1（元数据面）；uc-3-6 V5 | ✅ |
| `listSuggestions` / `classifySuggestion` | uc-3-6 V2 V6 | ✅ |
| `listSuggestionCases` | uc-3-6 V2 V10 | ✅ |
| `generateImprovementProposal` / `editProposal` | uc-3-6 R3 阶段三 | ✅ |
| `reviewProposal` | uc-3-6 V3 V4 V7 V8 V11 | ✅ |
| `getLoopMetrics` | uc-3-6 A6（四个计数） | ✅ |

**33 个操作全部有 UC 要求，无孤儿接口。**

⚠ 反向还查出一处**界面有、UC 没有**的东西：`/admin/feedback` 的
`admin-feedback-triage-{id}`「分诊并生成改进建议」把**归类**与**生成提案**合成了一个动作，
而 UC-3.6 明确要求两步分离（先归类，`实现层缺陷` 类**不出现**生成按钮）。
这不是多余接口，是**已建界面与契约相反**——见缺口 18。

---

## 九、签核时请重点看这四处

1. **缺口 9**：UC-3.2 的主载体屏（`设置 → 工作流编排`）在本仓**根本不存在**，
   而 UC 里写着「已存在、可直接签」。那句话指的是 HTML 原型。F63/F64 合计 8 点全压在这块屏上。
2. **缺口 14 + 18**：两处**已建界面与契约语义相反**（单选 skill chip vs 多选临时挂载；
   一键分诊生成 vs 先归类再决定按钮出不出现）。它们比「没建」更危险——看起来是有的。
3. **缺口 20**：最小样本量 / 浮现阈值必须进阈值登记表。本仓已因编造数值出过一次事故（S-04）。
4. **缺口 5 / 7 / 12**：三条跨束，都不该在本束解决——审计检索面、Context API 唯一通路的门控归属、
   职能层 vs 项目角色层。请在**阶段一致性复核**里统一定。
