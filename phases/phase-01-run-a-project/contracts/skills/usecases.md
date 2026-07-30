# 契约束 `skills` — 签核②：用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
已建成的 `/admin/skill` 是 happy path 演示（列表 + 两个新建入口 + 一个下线对话框），
六份 UC 里 **41 条异常流程（E1–E8 × 6）** 在界面上一条都没有。**别继承这个缺陷。**

---

## 统一失败枚举 `SkillError`

前端据此渲染七态之一（D-36），另加本束特有的 `待审核` / `被退回` / `已停用` / `待上线` 四态。

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `CONTRACT_VALIDATION_FAILED` | 静态契约校验失败（必填缺、schema 不可解析/不自洽、无失败兜底声明） | 逐条列出原因 | **不入库**（R3 步骤2） |
| `DATA_SCOPE_EXCEEDS_SUBMITTER` | 数据范围声明越出提交人当前权限 | 越权项逐条 + 申请授权入口 | I-12；**不进待审核队列**（E1/V6） |
| `RAW_TRANSCRIPT_NOT_AUTHORIZED` | 声明读原始转写但未获授权 | 需先取得原始转写授权 | `DATA_SCOPE_EXCEEDS_SUBMITTER` 的具名子类，因界面文案不同故单列 |
| `SECURITY_SCAN_REJECTED` | 安全扫描判 `reject` | 扫描拒绝原因 | `risk-pending-confirm` **不是错误**，转审核人裁决 |
| `GATE_NOT_PASSED` | 未过双门禁却尝试置为已启用/生效 | 需先通过安全扫描与方法论审核 | I-23；**写安全审计**（V2） |
| `SELF_REVIEW_FORBIDDEN` | 提交人 ＝ 审核人/复核人 | 需另一名审核人 | I-4；UC-3.1 V3、UC-3.6 V4 |
| `NO_SECOND_REVIEWER` | 组织内无第二名审核人 | 明确阻断并提示指派 | A4，与上一条区分：这是**组织配置问题**不是操作错误 |
| `REVIEWER_FUNCTION_MISMATCH` | 用错职能裁决（方法论审核人裁权限 / 安全评审人批 skill） | 该动作不属于你的职能 | I-5；UC-3.1 V14 |
| `SKILL_NOT_FOUND` | 不存在 **或** 可见性范围外 | 找不到该 skill | ⚠ I-14：**404 非 403**，不得泄露存在性 |
| `SKILL_NOT_ENABLED` | 绑定/挂载了非 `已启用` 的 skill | 只有已启用的 skill 可绑定 | 草稿/待审核/已停用不进池 |
| `SKILL_VERSION_CHANGED` | 并发改版/停用/编排 | 版本已变化，可刷新/对比/重提 | E5；乐观并发 `expectedVersion` |
| `TRIAL_RUN_SCHEMA_MISMATCH` | 试跑输出不符合 schema | 失败原因 + **可复制日志**（模型原文与差异） | **不入库**（E2/V7） |
| `MODEL_UNAVAILABLE` | 依赖模型被停用/不可用 | 明确失败，列出改选模型入口 | ⚠ **不得静默换模型**（V8、UC-3.4 V6） |
| `MCP_ISOLATED` | 依赖的 MCP 被隔离 | 依赖失败态 | UC-3.2 E2 |
| `DEPENDENCY_UNAVAILABLE` | 超时/网络/下游不可用 | 已保留当前输入与最后成功数据，可安全重试 | E4，六份 UC 一致 |
| `HARD_DELETE_FORBIDDEN` | 对存在任何引用的 skill 硬删 | 永久拒绝 + **返回引用清单** | I-13/V3 |
| `BUILTIN_NOT_DELETABLE` | 删 `source = CC` 的内置 skill | 内置不可删，只能停用/隐藏 | A4/V7 |
| `REFERENCES_NOT_ENUMERATED` | 未先列引用清单就停用 | 需先查看影响预览 | 「无清单不得停用」（R7） |
| `SLOT_KIND_MISMATCH` | 往 skill 槽写画布模板/agent 产物（或反之） | 类型不匹配 | I-15 |
| `TEMPLATE_WRITEBACK_FORBIDDEN` | 实例级写操作试图改模板本体 | 实例改动不回写模板；请用「另存为组织模板」 | I-17 |
| `ORPHAN_BINDING_UNRESOLVED` | 切模板/删环节但未逐条处置孤立绑定 | 列出将丢失的 N 条绑定与 M 条分工，需确认 | I-26；**确认前零写入** |
| `MEMBER_CANNOT_SELF_MOUNT` | 组员自行挂载 skill | 只能使用引导师下发的能力 | ⚠ **服务端拒绝 + 安全审计**，不是前端隐藏（V4） |
| `MOUNT_SCOPE_VIOLATION` | 临时挂载试图作用到别的线程/蓝本 | 临时挂载只对当前对话生效 | I-18 |
| `CONTEXT_BUDGET_EXCEEDED` | 挂载过多导致本轮上下文超预算 | 明确提示并要求取舍 | ⚠ **不得静默丢弃某个 skill 的注入**（E2） |
| `TODO_SYNC_FAILED` | 待办同步到任务模块失败 | 「N 条待办未同步」+ 重试 | E4；**编排保存成功但不得静默丢失** |
| `ATTRIBUTION_MISSING` | 评价缺 skill 版本记录 | 该评价只计 agent 级 | I-20；进数据质量报表，**不得随意归给某 skill** |
| `SAMPLE_INSUFFICIENT` | 满意度样本量不足 | 「样本不足」而非百分比 | I-21；⚠ 这是**一种正常返回态**，不是错误——放在这里是为了让前端有唯一的分支来源 |
| `NOT_CONTRACT_SOLVABLE` | 对 `实现层缺陷` / `模型能力所限` 类条目生成改进提案 | 该问题不由 skill 契约解决 | V6；只提供软件反馈通道 / 换模型入口 |
| `PROPOSAL_NOT_REVIEWED` | 改进提案未经人工复核就上线 | 需人工复核 | V3；**写审计** |
| `PROPOSAL_CONFLICT` | 同一 skill 并发两份改进提案 | 已有待复核提案：合并 / 排队 | E6 |
| `SCHEMA_BREAKING_UNACKNOWLEDGED` | 破坏 schema 的改进未在复核界面被显式确认 | 显著标出 + 列受影响引用 | E3/V8 |
| `RELEASE_FAILED_PENDING` | 复核通过但发版失败 | 提案停在「待上线」，可重试 + **明确通知** | E5；`vN` 保持生效 |
| `PROMOTION_ADMISSION_FAILED` | 晋升未满足严格准入（无签字决策 / 复盘未判对） | 明确指出缺哪一条 | D-32/V3 |
| `PROMOTION_REQUIRED_FIELDS_MISSING` | 三项必填缺任一（适用范围/有效期/复核负责人） | 缺项逐条 | V4；**skill 生成一并阻断** |
| `AI_SELF_PROMOTION_FORBIDDEN` | AI 试图自行晋升入库 | 拒绝 | V5；**安全审计** |
| `REDACTION_GATE_REQUIRED` | 含客户机密的方法未过脱敏闸门 | 需先完成脱敏 | D-16/V7 |
| `SOURCE_TAG_IMMUTABLE` | 试图写入/改写来源标记 | 来源标记由系统打标 | I-11/V10 |
| `PERMISSION_REVOKED` | 操作过程中权限被撤回 | 立即终止后续写操作 | E6，六份 UC 一致 |

⚠ 拒绝响应**不得泄露资源是否存在**：`SKILL_NOT_FOUND`（可见性范围外）与「真的不存在」必须不可区分。

---

## 用例

### 一、契约建立与门禁（F61 / F62）

#### `createSkillDraft` / `importSkillContract` —— UC-3.1 R3 步骤1

```
in:  { orgId, name, duty, contract: DeclarativeContract, visibility, modelRef }
out: { skillId, versionId, source }          // source 由系统按入口打标，入参无此字段
pre: 调用者持能力维护者权限（组织级）
err: CONTRACT_VALIDATION_FAILED | DATA_SCOPE_EXCEEDS_SUBMITTER | RAW_TRANSCRIPT_NOT_AUTHORIZED
   | MODEL_UNAVAILABLE | DEPENDENCY_UNAVAILABLE | PERMISSION_REVOKED
```

落 `草稿` 态（仅作者与能力维护者可见）。静态契约校验与数据范围越权检查**在服务端**，
以**提交人当前权限**为上界（R9）。⚠ 越权项直接判校验失败，**不进待审核队列**。

#### `runSecurityScan` —— 门禁第一道（自动）

```
in:  { versionId }
out: { verdict: pass|risk-pending-confirm|reject, findings: RiskItem[] }
pre: 版本处于草稿
err: SECURITY_SCAN_REJECTED | DEPENDENCY_UNAVAILABLE
```

扫描对象是**声明式内容本身**：提示词注入模式、越权数据范围申请、敏感字段外泄倾向、
对未授权 MCP 工具的引用。`risk-pending-confirm` 的风险项逐条转给审核人，确认理由留痕。

#### `runTrialRun` —— UC-3.1 R3 步骤4

```
in:  { versionId, sampleInput }
out: TrialRun                                 // 输入/输出/耗时/token/命中数据范围
pre: 版本存在；模型已启用
err: TRIAL_RUN_SCHEMA_MISMATCH | MODEL_UNAVAILABLE | DEPENDENCY_UNAVAILABLE
```

⚠ **失败不入库**，返回失败原因与**可复制日志**。超 10 秒转可离开页面的后台任务并保留结果（R9）。
⚠ 试跑样例输入若含客户数据，按 UC-20.3 机密路由选模型（跨束）。

#### `submitForReview` / `reviewSkillVersion` —— 门禁第二道（人工）

```
submitForReview:
in:  { versionId }         out: { status: 待审核 }
err: CONTRACT_VALIDATION_FAILED | SECURITY_SCAN_REJECTED | SKILL_VERSION_CHANGED

reviewSkillVersion:
in:  { versionId, decision: approve|reject, reason, riskAcks?: RiskItemId[] }
out: { skillStatus, versionState, reviewRecordId }
pre: 调用者持 methodology-reviewer 职能 ∧ **调用者 ≠ 提交人**
err: SELF_REVIEW_FORBIDDEN | NO_SECOND_REVIEWER | REVIEWER_FUNCTION_MISMATCH
   | GATE_NOT_PASSED | SKILL_VERSION_CHANGED | PERMISSION_REVOKED
```

⚠ **两道全过才能启用**（AC2）。任何绕过路径（直接置 `已启用`）返回 `GATE_NOT_PASSED` 并写安全审计。
⚠ 两职能不合并：安全评审人调用本用例返回 `REVIEWER_FUNCTION_MISMATCH`（I-5/V14）。

#### `listSkills` —— 四入口共用的可见性过滤

```
in:  { orgId, entry: "library"|"search"|"binding-panel"|"chat-mount", filter?: {source?, status?, visibility?}, q? }
out: { items: SkillListItem[], total }        // satisfaction 为 number | "insufficient"
pre: 调用者在该组织有对应读权限（组员/观察者默认不可见库）
err: SKILL_NOT_FOUND | PERMISSION_REVOKED
```

⚠ **四个入口必须共用同一份过滤判定**（I-14）。四处各写一遍就是第 N 次「同一事实声明在多处」。
空结果返回 `[]` 并由前端渲染真实空态，**不生成示例 skill**（A1/V10）。

#### `getSkillDetail`

```
in:  { skillId }
out: { skill, currentVersion, contract, latestTrialRun, gateResults, satisfaction, promotionLink? }
err: SKILL_NOT_FOUND
```

AC1：**每个 skill 都有可看的输入输出契约与最近一次试跑结果**——两者都在这里返回。

---

### 二、绑定到环节与角色（F63 / F64）

#### `applyWorkflowTemplate` —— R3 步骤1

```
in:  { projectId, workflowTemplateId, templateVersion }
out: ProjectOrchestration                     // 含 sourceTemplateVersion（如「来自后台 v2」）
pre: 调用者在该项目持引导师角色；切模板属「最终确认」动作 ⇒ 须主持人确认（O-03）
err: ORPHAN_BINDING_UNRESOLVED | SKILL_NOT_ENABLED | DEPENDENCY_UNAVAILABLE | PERMISSION_REVOKED
```

一次性写入环节链、绑定与三角色分工，**此后实例与模板本体解耦**。
⚠ 已有实例改动时**必须先返回将丢失的清单并要求确认**，确认前不执行（V6）。

#### `upsertSegmentBinding` —— R3 步骤3-6

```
in:  { projectId?, templateId?, segmentId, slotKind, skillId?, versionId?,
       deliverRoles[], trigger, expectedVersion }
out: SkillBinding
pre: 目标 skill 处于 已启用 ∧ 可见性范围覆盖调用者
err: SKILL_NOT_ENABLED | SKILL_NOT_FOUND | SLOT_KIND_MISMATCH | TEMPLATE_WRITEBACK_FORBIDDEN
   | SKILL_VERSION_CHANGED | PERMISSION_REVOKED
```

⚠ 绑定**必须记 `versionId`**（I-8），否则现场会随发新版漂移。
⚠ 超 6 个 skill：**提示不阻断**（V7）——返回 `warnings[]`，不是错误码。

#### `saveAsOrgTemplate`

```
in:  { projectId, name }
out: { workflowTemplateId }                   // 新建；原模板本体不变
pre: 主持人确认（O-03）
err: TEMPLATE_WRITEBACK_FORBIDDEN | PERMISSION_REVOKED
```

#### `previewOrphanBindings` / `confirmOrphanDisposition` —— A3/E-孤立绑定

```
previewOrphanBindings:
in:  { projectId, change: {kind:"switch-template"|"remove-segment", ...} }
out: { lostBindings: SkillBinding[], lostRoleCells: RoleCell[] }   // 纯读，零写入
confirmOrphanDisposition:
in:  { projectId, dispositions: Array<{bindingId, action:"migrate"|"delete", toSegmentId?}> }
out: { applied: n }
err: ORPHAN_BINDING_UNRESOLVED | SKILL_VERSION_CHANGED
```

⚠ **没有绑定条目被静默丢弃**（AC6/V6）。

#### `generateRoleTodos` —— R3 步骤5（跨束边）

```
in:  { projectId }
out: { created: TodoRef[], failed: RoleCellRef[] }
err: TODO_SYNC_FAILED | DEPENDENCY_UNAVAILABLE
```

⚠ 每个非空角色格 → 恰一条待办（I-16），`assignee` 恒为人、agent 记 `executor`（D-39）。
⚠ 同步失败**编排仍保存成功**，但必须返回 `failed` 让界面显示「N 条待办未同步」并可重试（E4/V12）。

#### `resolveMountedSkills` —— R3 步骤7：现场按环节自动挂载

```
in:  { projectId, segmentId, role, groupId? }
out: { mounts: Array<{skillId, versionId, trigger, reason: "因环节 03 载入"}> }
pre: 调用者在该项目可见该环节
err: SKILL_NOT_FOUND | MODEL_UNAVAILABLE | MCP_ISOLATED | DEPENDENCY_UNAVAILABLE
```

⚠ `reason` 是契约的一部分——AC1 要求「能看到因什么环节载入」。
⚠ 依赖失败时该条标「依赖失败」并明确告知，**不静默跳过、不换模型**（E2）。
⚠ 组员侧只读：本用例返回的 `mounts` 对组员**无任何写入口**；直调写接口被拒（V5）。

#### `listIdleSkills` —— A5/V8

```
in:  { orgId }      out: { idle: SkillRef[] }       // 未被任何环节绑定
err: PERMISSION_REVOKED
```

---

### 三、对话内临时加减（F65）

#### `listMountableSkills` —— R3 步骤1：选择器可选池

```
in:  { threadId }
out: { boundBySegment: SkillRef[], mountable: SkillRef[] }   // 前者置顶且只读，标「本议程环节已绑定」
pre: 池子 = 已启用 ∩ 可见性范围覆盖当前用户 ∩ 当前角色被允许自行挂载
err: MEMBER_CANNOT_SELF_MOUNT | SKILL_NOT_FOUND | PERMISSION_REVOKED
```

⚠ 依赖不可用的 skill **在池中显示为不可选并说明原因**（V6）——是 `mountable[].disabledReason`，不是过滤掉。

#### `mountSkillToThread` / `unmountSkillFromThread`

```
mountSkillToThread:
in:  { threadId, skillIds[], expectedVersion }
out: { mounts: ThreadSkillMount[] }
pre: 调用者为引导师，或组长且引导师已下放该权限（⚠ 见 domain D-h）
err: MEMBER_CANNOT_SELF_MOUNT | MOUNT_SCOPE_VIOLATION | SKILL_NOT_ENABLED
   | CONTEXT_BUDGET_EXCEEDED | SKILL_VERSION_CHANGED | PERMISSION_REVOKED

unmountSkillFromThread:
in:  { threadId, mountId }      out: { removedAt }
err: SKILL_VERSION_CHANGED | PERMISSION_REVOKED
```

⚠ 只对当前这条对话生效，**不改蓝本、不改实例编排**（I-18/V2）。
⚠ 摘除**不回溯历史消息角标**（I-19/V3）。
⚠ 超预算时明确要求取舍，**不静默丢弃某个 skill 的注入**（E2）。
⚠ 临时挂载**不构成提权**：其数据范围仍受三层权限约束（R9）。

#### `listThreadDeviations` / `submitMountBackToTemplate` —— 复盘（AC1）

```
listThreadDeviations:
in:  { threadId }   out: { temporary: ThreadSkillMount[], vsBinding: Diff }
submitMountBackToTemplate:
in:  { mountId, target: "org-template"|"project-instance"|"ignore" }
out: { workflowTemplateId? }                 // org-template 走 saveAsOrgTemplate（不回写模板本体）
err: TEMPLATE_WRITEBACK_FORBIDDEN | PERMISSION_REVOKED
```

---

### 四、版本与停用（F66）

#### `publishNewVersion`

```
in:  { skillId, contract, expectedHeadVersion }
out: { versionId, versionNumber, contentHash, state: 草稿 }
pre: 能力维护者；**不覆盖当前生效版本**
err: CONTRACT_VALIDATION_FAILED | DATA_SCOPE_EXCEEDS_SUBMITTER | SKILL_VERSION_CHANGED
   | SCHEMA_BREAKING_UNACKNOWLEDGED | PERMISSION_REVOKED
```

新版本**不豁免门禁**：照走 `runSecurityScan` + `reviewSkillVersion`。
审核通过后 `vN+1` 生效、**`vN` 自动归档**（I-6）；数据范围扩大的改版须在审核界面显著标出。

#### `listReferences` —— 停用前置（AC4）

```
in:  { skillId }
out: { inFlightProjects: [], templateBindings: [], agentMounts: [] }   // 三类，可空但必须显式返回
err: SKILL_NOT_FOUND | DEPENDENCY_UNAVAILABLE
```

⚠ **无清单不得停用**（R7）：`disableSkill` 未携带本用例产出的 `referenceSnapshotId` 时返回
`REFERENCES_NOT_ENUMERATED`。规模大时转异步并给进度（R9）。

#### `disableSkill` / `restoreSkill`

```
disableSkill:
in:  { skillId, referenceSnapshotId, mode: "interrupt"|"drain", archive?: boolean, replacementSkillId? }
out: { status: 已停用, archived }
err: REFERENCES_NOT_ENUMERATED | BUILTIN_NOT_DELETABLE(仅硬删路径) | SKILL_VERSION_CHANGED | PERMISSION_REVOKED

restoreSkill:
in:  { skillId }   out: { status: 已启用 }      // 重新进可绑定池；历史引用不受影响（V8）
```

⚠ `mode` 复用 phase-1 已建成的 `DisableDialog`（立即中断 / 跑完当前一轮）——**同一事实不得再写一份**。
⚠ 停用后：新蓝本/新项目/新对话选不到它；**进行中的按锁定版本跑完**（AC1/V1）。
⚠ `replacementSkillId` 只做「推荐替代」，改指**仍需引导师确认，不自动执行**（A3）。

#### `hardDeleteSkill` —— 永久拒绝路径

```
in:  { skillId }
out: never
err: HARD_DELETE_FORBIDDEN(带引用清单) | BUILTIN_NOT_DELETABLE
```

⚠ 这个用例**只有失败出口**。存在任何引用（含历史项目）即永久拒绝；`source = CC` 一律拒绝。
删除请求走合规删除流程（17-gov / UC-17.2），不在本束。

#### `upgradeBindingToVersion` —— 蓝本侧显式升级

```
in:  { bindingId, toVersionId }
out: SkillBinding
pre: 引导师确认；**默认不自动跟随**（提示不阻断）
err: SKILL_NOT_ENABLED | SKILL_VERSION_CHANGED | PERMISSION_REVOKED
```

---

### 五、晋升生成（F67，**phase-1 只做接收端**）

#### `UC-P1 receivePromotedSkill` —— 接收端（触发端在 14-brain / phase-3）

```
in:  { orgId, knowledgeItemId, signedDecisionId, reviewConclusionId,
       draftContract: Partial<DeclarativeContract>, applicableScope, validUntil, reviewOwnerId,
       redactedOnly: boolean }
out: { skillId, versionId, status: 待审核, source: "晋升生成" }
pre: 严格准入已成立（支撑过签字决策 ∧ 复盘判对，D-32）；三项必填齐全；含机密者已过脱敏闸门
err: PROMOTION_ADMISSION_FAILED | PROMOTION_REQUIRED_FIELDS_MISSING | AI_SELF_PROMOTION_FORBIDDEN
   | REDACTION_GATE_REQUIRED | SOURCE_TAG_IMMUTABLE | DEPENDENCY_UNAVAILABLE
```

⚠ **自动生成 ≠ 自动发布**：落 `待审核`，绕过被拒（I-23/V2）。
⚠ 转写不完整时**留空并标待补，不得臆造 schema**；数据范围取**最小必要**，不继承提名人全部权限。
⚠ **不得静默失败**：Skill 库不可写时晋升操作明确失败并给重试入口（E8/V11）。
⚠ 「同一自然人在同一条晋升链上只行使一次裁决」——做了晋升审批者不能再审本 skill（I-5）。

#### `linkKnowledgeToSkill` / `getPromotionProvenance`

```
getPromotionProvenance:
in:  { skillId }
out: { knowledgeItem, signedDecision, reviewConclusion, applicableScope, validUntil, reviewOwner }
err: SKILL_NOT_FOUND
```

「来自组织大脑」区块的数据源；**双向可达**（I-22）。

#### `onSourceKnowledgeStateChanged` —— E5/E6/E7 联动

```
in:  { knowledgeItemId, newState: "待复核"|"被推翻"|"被撤销"|"被替代", replacedByKnowledgeId? }
out: { effect: "annotate"|"disable"|"new-version", skillId, versionId? }
err: SKILL_NOT_FOUND | DEPENDENCY_UNAVAILABLE
```

- `待复核` → **标注「源方法已过期」，不自动停用**（⚠ domain D-j 待裁决）
- `被推翻` / `被撤销` → 自动转 `已停用`，**不硬删**，进行中项目不受影响（AC3/V8）
- `被替代` → 发新版、旧版归档、已建实例锁版本（V9）

#### `listPromotedSkills`

```
in:  { orgId }   out: { items }    // 按 source = 晋升生成 筛出全部
```

---

### 六、改进反馈与版本触发（F68）

#### `rateMessage` —— 阶段一：采集与归因

```
in:  { messageId, verdict: up|down, reason? }
out: { ratingId, attribution: { agentId, skillId?, skillVersionId? } }
pre: 调用者能看到该消息
err: ATTRIBUTION_MISSING(记录但只计 agent 级) | PERMISSION_REVOKED
```

⚠ 评价**不公开署名**（D-40 同源）；同一人对同一消息重复评价**只计一次**（V13，幂等键 `(messageId, raterId)`）。
⚠ 缺 `skillVersionId` 的评价**不计入任何 skill 满意度**并进数据质量报表（I-20/V9）。

#### `getSatisfaction`

```
in:  { skillId, window? }
out: { value: number, sampleSize } | { insufficient: true, sampleSize }
```

⚠ 口径 `👍/(👍+👎)`，不含未评价、不加权（O-37）。样本不足返回 `insufficient`（I-21/V5）。
⚠ **最小样本量的数值来自阈值登记表**（`packages/contracts/src/thresholds.ts`），不在本束硬编码。

#### `listSuggestions` / `classifySuggestion`

```
listSuggestions:
in:  { orgId, skillId? }
out: { items: Array<{ id, target, issueLabel, thumbsDownCount, caseCount, cohortText,
                      adviceText, category, machineGenerated: true }> }
classifySuggestion:
in:  { suggestionId, category: "contract-solvable"|"implementation-defect"|"model-limited" }
```

⚠ 聚合键是**结构性判据** `(skillId, versionId, agentId, 人工归类标签)`（O-35），**不用相似度打分**。
⚠ `thumbsDownCount` 与 `caseCount` **分别标注口径，不得混用**（原型 👎9 / 12 案例）。
⚠ 建议文案由 AI 产出，**必须带机器产出标记并可展开原始案例核对**（I-27）。

#### `listSuggestionCases`

```
in:  { suggestionId, page }
out: { cases: Array<{ messageExcerpt, skillVersionId, segmentId, projectId, reason? }> }
err: PERMISSION_REVOKED
```

⚠ 含客户机密的案例按权限门控：无权者**只见计数与脱敏摘要**（E2/V10）。

#### `generateImprovementProposal` / `editProposal`

```
generateImprovementProposal:
in:  { suggestionId }
out: { proposalId, versionId(vN+1 草稿), diff, schemaBreaking, machineGenerated: true }
pre: 聚合项 category = contract-solvable
err: NOT_CONTRACT_SOLVABLE | PROPOSAL_CONFLICT | MODEL_UNAVAILABLE | DEPENDENCY_UNAVAILABLE

editProposal:
in:  { proposalId, patch }    out: { humanEdits: n }      // AI 起草 / 人工修改分段留痕
```

⚠ 提案生成模型不可用时**明确失败**，**不得产出半截 diff 当成提案**（E4）。
⚠ 含机密案例送模型时走自托管模型（UC-20.3，跨束）。

#### `reviewProposal` —— 人工复核门禁

```
in:  { proposalId, decision: approve|reject, reason, schemaBreakingAck?: boolean }
out: { released: boolean, versionState }      // approve ⇒ 触发 publishNewVersion 的发布路径
pre: 调用者持 methodology-reviewer ∧ **≠ 提交人**
err: SELF_REVIEW_FORBIDDEN | PROPOSAL_NOT_REVIEWED | SCHEMA_BREAKING_UNACKNOWLEDGED
   | RELEASE_FAILED_PENDING | PERMISSION_REVOKED
```

⚠ 复核通过后：`vN+1` 上线、`vN` 自动归档、**已建实例锁版本**（V7）。
⚠ 发版失败 ⇒ `vN` 保持生效、提案停「待上线」可重试，**且必须有明确通知**（E5/V11）。

#### `getLoopMetrics`

```
in:  { orgId, month }
out: { feedbackCount, proposalCount, releasedCount, satisfactionDelta }   // 四个计数（A6）
```

---

## 端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `SkillRepository` | skills / skill_versions / 契约正文与哈希 | PostgreSQL（RLS 强制） |
| `BindingRepository` | 模板级与实例级绑定、编排表、角色格 | PostgreSQL |
| `ThreadMountRepository` | 对话临时挂载条目 | PostgreSQL |
| `RatingRepository` | 消息级评价与归因链（幂等键） | PostgreSQL |
| `SuggestionAggregator` | 按**结构性判据**聚合，非相似度打分 | 批处理（按小时） |
| `ContractValidator` | 静态契约校验（必填 / schema 自洽 / 失败兜底） | 纯函数 |
| `DataScopeChecker` | 数据范围 ⊆ 提交人权限（服务端，跨 identity/mcp 束） | 服务 |
| `SecurityScanner` | 声明式内容的注入/越权/外泄扫描 | 服务（规则集待安全负责人给出） |
| `ContextApiClient` | **唯一取数通路**，返回 Context Pack 并落 `context_packs` | context-pack 束 |
| `ModelGateway` | 模板渲染 → 模型调用 → schema 校验（一次同步调用） | 20-model |
| `TodoPublisher` | 角色格 → 待办，异步可重试，不阻塞编排保存 | outbox + worker（11-board） |
| `AuditWriter` | 发布/退回/停用/恢复/硬删尝试/越权尝试 | append-only |

⚠ `ContextApiClient` **不能只是「约定不直查」**——I-25 要求架构依赖规则可断言：
skill 运行时模块的 import 图里不得出现任何 DB / 向量库客户端。
