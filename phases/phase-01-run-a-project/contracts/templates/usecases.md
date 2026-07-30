# 契约束 `templates` — 签核② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL、不知道 React。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
>
> ⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
> 本束的原型是 happy path 演示（蓝本设计器整屏可查，但零异常态；UC-2.3 两侧屏一个未探明、
> 一个确认缺失）。**别继承这个缺陷。**

---

## 统一失败枚举 `TemplateError`

前端据此渲染七态之一（默认 / 加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功）。

| 码 | 场景 | 前端应显示 | 依据 |
|---|---|---|---|
| `NO_ORG_ROLE` | 组织层无角色 | 组织层限制：你在本组织没有对应角色 | R5，判定属 `identity` 束，此处透传 |
| `NO_PROJECT_ROLE` | 项目层无角色 | 项目层限制：你在本项目没有对应角色 | R5，同上 |
| `ROLE_INSUFFICIENT` | 角色不够 | 你的角色不能执行该动作 | 观察者不得写；组员不得改筹备 |
| `NOT_BLUEPRINT_MAINTAINER` | 非蓝本维护者试图合并 | 已提交，等待 <维护者> 审阅 | uc-2-3 A1 / V5。⚠ 维护者的定义见 domain D-1 |
| `BLUEPRINT_NOT_FOUND` | 不存在 / 越权可见 | 找不到该蓝本 | ⚠ 越权与「真的不存在」**必须不可区分**，不得泄露资源存在性 |
| `BLUEPRINT_NOT_VISIBLE` | 可见性范围外（team-only） | 该蓝本仅对 <团队> 可用 | uc-2-4 V7d，须标明为**组织层**限制（对照 uc-0-3 V3） |
| `REQUIRED_CONFIG_INCOMPLETE` | 必填配置项未完成 | 还有必填项未完成（附直达第一个未完成项的入口） | uc-2-1 E1 / AC3b。detail 带 `missingKeys[]` 供侧栏高亮 |
| `TRIAL_RUN_REQUIRED` | 未试跑就发布 | 试跑一场后才能发布（附 `[试跑一场]` 直达） | uc-2-1 E2 / AC3a。**不产生版本号** |
| `BLUEPRINT_VERSION_ARCHIVED` | 用已归档版本新建项目 | 该版本已归档，不能再用它新建项目 | I-7（禁止新增绑定；**存量实例化不受此拒**） |
| `BLUEPRINT_NOT_PUBLISHED` | 用草稿蓝本套用 | 该蓝本还是草稿，先发布才能套用 | uc-2-2 R3 步骤1「选一个**已发布**的蓝本」 |
| `VERSION_CHANGED` | 并发编辑 / 并发发布 | 版本已变化，可刷新、对比或重新提交 | E4 / E2；**冲突粒度按单个配置项**，不整份锁死 |
| `BLUEPRINT_IN_USE` | 删除已被套用的蓝本 | 有 N 个项目仍引用此蓝本，请改用归档 | I-8 / O-18 ①。detail 带 `referencingProjectCount` |
| `ROLLBACK_TARGET_IN_USE` | 回滚到进行中项目正用的版本 | 以下进行中项目正用着该版本：… | uc-2-4 A1 / V7。**必须列出项目清单，不得只给一句失败** |
| `INITIALIZATION_FAILED` | 六类写入部分失败 | 初始化失败（失败类别：<类别>），已整体回滚，可重试 | uc-2-2 E2。detail 带失败的**类别名** |
| `TASK_SYNC_FAILED` | 矩阵格 → 待办同步失败 | 待办同步失败，可重试（重试不会产生重复卡） | uc-2-2 E3。**不得静默不一致** |
| `RATIONALE_REQUIRED` | 回提未填理由 | 每条沉淀都要写一句为什么 | uc-2-3 V4 / I-11 |
| `NO_DEVIATIONS` | 偏离清单为空 | 本场完全照蓝本跑，没有可沉淀的偏离 | uc-2-3 A3。**真实空态，不强行凑条目** |
| `CHANGE_REQUEST_STALE` | 待审改动的基准版本已过时 | 该改动基于 v<N>，蓝本已到 v<M>，请确认是否仍适用 | uc-2-3 R7。⚠ **不自动失效**，由维护者判断 |
| `CONFIDENTIAL_ROUTE_VIOLATION` | 机密调用被路由到非本地模型 | 机密材料只能走本地模型 | I-21。**这是硬路由违规，不是配额问题** |
| `AUTOSAVE_FAILED` | 草稿自动保存失败 | 未保存（明确失败原因 + 安全重试） | uc-2-1 E3 / V12。⚠ **不得把「未保存」显示成「已自动保存」** |
| `DEPENDENCY_UNAVAILABLE` | 依赖不可用（模型网关 / 存储 / 任务模块） | 依赖不可用，已保留当前输入与最后成功数据，可安全重试 | E3 / E4 |
| `PERMISSION_REVOKED_MIDWAY` | 操作过程中权限被撤回 | 权限已变更，未提交内容留在本地草稿，请重新授权 | E5 / E3 |

⚠ **拒绝响应不得泄露资源是否存在**：`BLUEPRINT_NOT_FOUND`（越权）与「真的不存在」必须不可区分。

---

## 一、定义层用例（蓝本设计与发布）

### `listConfigItemDefinitions` —— 配置项定义表（分母与必填的唯一事实源）

```
UC: 读配置项定义表
  in:  { orgId }
  out: { items: ConfigItemDefinition[], denominator: int }   // denominator = items.length
  pre: 调用者在该组织可读
  err: NO_ORG_ROLE | DEPENDENCY_UNAVAILABLE
```
⚠ `denominator` **必须由服务端从表派生返回**，不许前端自己数、更不许任何一侧写 16 或 15（I-5）。

### `createBlueprint` —— 新建三入口（A0）

```
UC: 新建蓝本
  in:  { orgId, name, from: {kind:"blank"} | {kind:"copy", blueprintId}
                        | {kind:"reverse-from-project", projectId} }
  out: { blueprintId, unmappedConfigItemKeys: string[] }
  pre: 调用者是方法负责人
  err: NO_ORG_ROLE | ROLE_INSUFFICIENT | BLUEPRINT_NOT_FOUND
     | REVERSE_MAPPING_PARTIAL(告警非失败) | DEPENDENCY_UNAVAILABLE
```
「从已办过的项目反向生成」把源项目实际用过的问卷/画布/素材**映射回各项设计配置**；
**未能映射的项留空并计入完成度缺口**（`unmappedConfigItemKeys`，uc-2-1 V13）。
映射结果是 **AI/机器产出**，必须标识并展示来源（R7 通用条）。

### `updateConfigItem` —— 逐项独立保存 + 完成度派生

```
UC: 保存一项设计配置
  in:  { blueprintId, configItemKey, value, expectedItemRevision }   // 乐观并发，粒度=单项
  out: { itemRevision, completed: boolean, completeness: {done:int, denominator:int} }
  pre: 调用者是方法负责人；蓝本未被冻结
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | VERSION_CHANGED
     | AUTOSAVE_FAILED | PERMISSION_REVOKED_MIDWAY | DEPENDENCY_UNAVAILABLE
```
⚠ **冲突粒度是单个配置项，不是整份蓝本**（E4）：两人改**不同**项互不覆盖（V17）；
改**同一项**才 `VERSION_CHANGED`。
⚠ 草稿自动保存只走这里，返回的 `autosavedAt` 必须是**真实写入时刻**；
写失败时**必须**返回 `AUTOSAVE_FAILED`，界面不得继续显示「已自动保存」（V12）。

### `setDurationTier` —— 时长档位与议程环节表联动

```
UC: 换时长档位
  in:  { blueprintId, tier: "half-day"|"one-day"|"two-day"|"three-day"|{custom}, confirmed: boolean }
  out: { agendaStageCount:int, added: StageRef[], removed: StageRef[], recoverable: StageRef[] }
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | TIER_CHANGE_NEEDS_CONFIRMATION
     | CUSTOM_TIER_RULE_UNDEFINED | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
- `confirmed: false` ⇒ 返回 `TIER_CHANGE_NEEDS_CONFIRMATION` + **将被增删的议程环节清单**
  （换档位是破坏性变更，R8 推荐交互）。
- 已填内容**不得静默丢弃**：被移除的可选环节进 `recoverable`，提示「切回该档位可恢复」（A1）。
- ⚠ **`CUSTOM_TIER_RULE_UNDEFINED`**：自定义档位下的环节数推导规则未定（domain D-7），
  **宁可拒绝也不猜一个推导式**。
- ⚠ 「可选自动增删 / 必留只压缩时间」是 **[Backlog] 口径**，原型只说「环节表随之变化」——
  见 domain D-8，**签核时需人类定稿**。

### `setFormatAndLanguage` —— 形式与语言

```
UC: 设默认形式与语言
  in:  { blueprintId, format: "hybrid"|"onsite"|"online", language: "zh"|"en"|"bilingual" }
  out: { agendaStageCount:int, autoAdded: StageRef[], autoRemoved: StageRef[] }
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
`format = "online"` ⇒ **自动追加「破冰」「举手排队」两个议程环节**，标记 `addedBy: "format-setting"`；
切回 `hybrid`/`onsite` **对称移除**并提示（I-16，V5）。

### `setModelStrategy` —— 三条按场景分派的策略

```
UC: 配模型策略
  in:  { blueprintId, lanes: { onsite: ModelRef, postSession: ModelRef, confidential: ModelRef } }
  out: ModelStrategy
  pre: 调用者是方法负责人；三个 ModelRef 均在本组织**已启用模型**清单内（D-07）
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | MODEL_NOT_ENABLED
     | CONFIDENTIAL_ROUTE_VIOLATION | DEPENDENCY_UNAVAILABLE
```
⚠ `confidential` lane **只接受本地/自托管模型**，否则 `CONFIDENTIAL_ROUTE_VIOLATION`——
这是隐私硬路由，不是性能偏好（对齐 D-17 闭源/自托管二分、proto-03「含客户机密 → 禁止降级」）。

### `setQuotaPolicy` —— 配额与降级

```
UC: 配配额与降级
  in:  { blueprintId, perSessionTokenBudget:int, downgradeAtRatio: number }
  out: QuotaPolicy
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
⚠ **`hardStop` 不是可配项，恒为 false**：达阈值只降级 + 在对话流可见提示，**不得中断现场**
（「现场卡住比多花钱贵。」）。降级必须**可见**，不得静默（V11）。
⚠ 与组织/成员/Agent 三级阈值的取舍未定（domain D-3）——本用例只落**蓝本级**。

### `getInitializationPreview` —— 「套用后会初始化什么」六类一览

```
UC: 生成初始化一览
  in:  { blueprintId, versionId?: BlueprintVersionId, tier?: DurationTier }
  out: { categories: [六类，恒 6 个] , items: InitItem[] }
  pre: 调用者对该蓝本可读
  err: BLUEPRINT_NOT_FOUND | BLUEPRINT_NOT_VISIBLE | DEPENDENCY_UNAVAILABLE
```
⚠ **本用例与 `applyBlueprint` 共用同一份契约**（uc-2-1 R11 第 6 项明写）——
「一览」与「实际写入」若各算各的，AC2「逐项对得上」就是自证的空转（I-17）。
一览随配置**实时变化**（V9）。

### `previewParticipantView` —— 只读预览

```
UC: 预览参与者视图
  in:  { blueprintId }
  out: ParticipantViewSnapshot        // 以组员可见性渲染当前草稿
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
⚠ **不改变草稿状态、不产生版本**（R3 第 7 步）。

### `startTrialRun` —— 试跑一场（发布前置条件）

```
UC: 试跑一场
  in:  { blueprintId }
  out: { trialRunId, trialRunDone: true }
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
⚠ 试跑实例**不计入「用过 N 次」**（I-22）。
⚠ **[待人类裁决]** 「已试跑」的判定：创建实例即算，还是需跑完/需产出？试跑数据可否删、是否计入配额
（domain D-6）。**按「创建即算」实现会让 AC3a 这道门槛形同虚设。**

### `publishBlueprintVersion` —— 两道并列门槛 + 事务性

```
UC: 发布新版本
  in:  { blueprintId, expectedCurrentVersionNumber:int }
  out: { versionId, versionNumber, changedConfigItemKeys: string[], archivedVersionId }
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT
     | REQUIRED_CONFIG_INCOMPLETE | TRIAL_RUN_REQUIRED          // 两道并列门槛，缺一不可
     | VERSION_CHANGED | PERMISSION_REVOKED_MIDWAY | DEPENDENCY_UNAVAILABLE
```
- 门槛判定语句恒为「**存在 `required = true` 且未完成的项 ⇒ 阻断**」（I-6），与具体是哪几项无关。
- **生成 v(n+1) 与旧版归档必须同事务**（E6）：不得出现「新版已生成但旧版仍为当前版」或反之。
- **失败不占版本号**（I-3，V18）。
- ⚠ `REQUIRED_CONFIG_INCOMPLETE` 是 **[Backlog] 口径且与原型冲突**（domain D-9）：
  原型里 `15/16`、`12/16`、`9/16` 的蓝本**均为已发布**。签核时请确认 O-18 ⑤ 的和解成立。
- ⚠ 「旧版自动归档」的原话出自**画布模板**屏，属跨对象挪用（[设计]），O-18 ③ 已裁为同规则。

---

## 二、版本与锁定用例

### `listBlueprints` —— 列表元数据

```
UC: 列蓝本
  in:  { orgId, filter?: {state?, visibleToMe?: true} }
  out: BlueprintRow[]   // 名称 / 状态与版本 / 议程环节数·时长 / 用过N次 / 满意度 / 完成度 n/N / 可用行操作
  pre: 调用者在该组织可读
  err: NO_ORG_ROLE | DEPENDENCY_UNAVAILABLE
```
⚠ **`agendaStageCount` 与 `completeness` 是两个独立字段，不得串位**（D-03，V4）。
⚠ 满意度：`sampleSize` 低于阈值时**不返回数值分数**，只返回 `{ insufficientSample: true }`（I-19）。
⚠ 行操作由服务端派生：`appliedProjectCount > 0` ⇒ 返回 `archive`，**不返回 `delete`**（I-8）。

### `copyBlueprint`

```
UC: 复制蓝本
  in:  { blueprintId }
  out: { newBlueprintId }     // 草稿态、无版本号、用过 0 次、满意度空
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
新蓝本与源蓝本**不共享版本线**；改新蓝本不影响源蓝本（V5）。

### `archiveBlueprint` / `deleteBlueprint` —— 引用计数门控

```
UC: 归档蓝本
  in:  { blueprintId, confirmed: boolean }
  out: { archived: true, referencingProjectCount:int, referencingAgendaStageCount:int }
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | NEEDS_CONFIRMATION | DEPENDENCY_UNAVAILABLE

UC: 删除蓝本
  in:  { blueprintId, confirmed: boolean }
  out: { deleted: true }
  pre: 调用者是方法负责人；**该蓝本从未被任何项目套用过**
  err: BLUEPRINT_IN_USE | BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT
     | NEEDS_CONFIRMATION | DEPENDENCY_UNAVAILABLE
```
⚠ **删除接口不得存在任何强制参数可绕过引用计数判定**（V7b / I-8）。
⚠ 归档确认框须提示「有 N 个项目 / N 个议程环节仍绑定此蓝本」。
⚠ 归档**不影响可达性**：已套用项目仍可实例化（I-7）——这是防现场跑挂的关键。

### `rollbackToVersion` —— 回滚 = 新建等同旧版的新版本（O-18 ②）

```
UC: 回滚
  in:  { blueprintId, targetVersionId }
  out: { newVersionId, newVersionNumber, rolledBackFrom: targetVersionId }
  pre: 调用者是方法负责人；targetVersion **未被任何进行中项目使用**
  err: ROLLBACK_TARGET_IN_USE | BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT
     | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
⚠ 版本号**只增不减，历史线性**：v5 回到 v3 的内容 ⇒ 产生 **v6（内容 = v3）**，记 `rolled_back_from: v3`；
**不存在「当前版本指针被改回 v3」的状态**。
⚠ `ROLLBACK_TARGET_IN_USE` 必须在 detail 里**列出正在用它的进行中项目**（A1）。

### `setBlueprintVisibility`

```
UC: 设可见性范围
  in:  { blueprintId, visibility: "org-wide"|"team-only", teamId? }
  out: Blueprint
  pre: 调用者是方法负责人
  err: BLUEPRINT_NOT_FOUND | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
⚠ 与 MCP 的授权范围（仅项目负责人 / 全体成员 / 待安全评审）**不是同一维度，禁止合并成同一字段**
（uc-0-3 R7，I-27）。

### `queryBlueprintAudit`

```
UC: 审计检索
  in:  { blueprintId?, actorId?, action?, since?, until? }
  out: AuditEvent[]        // 发布/换档位/改模型策略/改配额/删除/复制/归档/回滚/合并 均可检索
  pre: 调用者在该组织可读审计
  err: NO_ORG_ROLE | DEPENDENCY_UNAVAILABLE
```
⚠ **越权尝试也必须有安全审计记录**（V19 / V18 / V6）。
🔗 **跨束**：phase-00 `artifact` 束的 `queryProvenance` 与 `identity` 束的审计写入是同一件事的另外两处。
**应是统一的审计查询面，不要每束各造一个**——见 coverage 缺口 ⑦。

---

## 三、实例层用例（套用与筹备）

### `applyBlueprint` —— 六类初始化 + 快照绑定（本束最重的一次写）

```
UC: 套用蓝本新建项目
  in:  { orgId, blueprintId, versionId?, tier?, projectName, idempotencyKey }
  out: { projectId, blueprintVersionId, initialized: {六类各自的写入计数} }
  pre: 调用者可新建项目；目标版本为 published（非 archived、非 draft）；调用者在该蓝本可见性范围内
  err: BLUEPRINT_NOT_FOUND | BLUEPRINT_NOT_VISIBLE | BLUEPRINT_NOT_PUBLISHED
     | BLUEPRINT_VERSION_ARCHIVED | INITIALIZATION_FAILED
     | NO_ORG_ROLE | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
- **六类写入要么全部成功、要么整体回滚**，不得建出「有议程没分组」的半成品（E2 / V12）。
  `INITIALIZATION_FAILED` 的 detail **必须指明失败的类别名**。
- **幂等**：同一 `idempotencyKey` 重复提交（双击 / 重试）只建出**一个**项目（V13）。
- 写入的是 `blueprintVersionId` 的**引用**（不是深拷贝），此后不随蓝本发布漂移（I-1 / I-4）。
- 项目也可停在「只选了蓝本、主题与分组还没定」的低准备度状态（A2）——**套用不要求同时完成定题**。

### `getProjectPrep` —— 项目筹备页四子标签

```
UC: 读项目筹备
  in:  { projectId }
  out: { tabs: [{key, label, count}] }   // 定题与分组 / 议程 N 环节 / 材料准备 M 份 / 会前任务 x/y
  pre: 调用者对该项目可见
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE
```
计数必须与后端实际条目数一致，改数据后同步刷新（V6）。
⚠ 不套蓝本的空项目：四子标签**真实空态，不生成示例分组或示例议程**（V15）。

### `saveAndSyncTopic` —— 定题单点继承

```
UC: 保存并同步到全场
  in:  { projectId, title, background, expectedTopicRevision, aiGenerated?: {sources: SourceRef[]} }
  out: { topicId, syncedTo: ["grouping","agenda","ai-context"] }
  pre: 调用者对该项目有写权限
  err: NO_PROJECT_ROLE | ROLE_INSUFFICIENT | VERSION_CHANGED
     | AI_SOURCES_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
⚠ **整场只有一个主题、一段背景**（I-13）：`syncedTo` 的三处读的是**同一个 topicId**，
系统中不存在第二份主题/背景记录（V5）。
⚠ AI 生成的主题/背景**必须标识为机器产出并挂来源**；来源不足时 `AI_SOURCES_INSUFFICIENT`，
**不得伪造**（R7 通用条 / V8）。AI 产出未经人确认**不落为最终值**。

### `updateGrouping` / `updateInterviewSubjects`

```
UC: 分组编排
  in:  { projectId, groupCount?, groups?: GroupPatch[], expectedRevision }
  out: Group[]
  pre: 调用者对该项目有写权限
  err: NO_PROJECT_ROLE | ROLE_INSUFFICIENT | VERSION_CHANGED
     | INVALID_GROUP_STATUS | GROUP_LEADER_REQUIRED | DEPENDENCY_UNAVAILABLE

UC: 填观察/访谈对象表
  in:  { projectId, groupId, subjects: InterviewSubject[] }   // 六列
  out: InterviewSubject[]
  pre: 调用者对该项目有写权限
  err: NO_PROJECT_ROLE | ROLE_INSUFFICIENT | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
⚠ `Group.status` 三值封闭，`INVALID_GROUP_STATUS` 拒绝第四态（I-14 / V7）。
⚠ 每组必须有一个场景与一位组长（`GROUP_LEADER_REQUIRED`）。
⚠ `[AI 按背景均衡分组]` / `[AI 按背景分配]` / `[AI 建议人选]` 的结果是**建议，需人确认后生效**（V8）。
⚠ 对象表本用例只落**结构与填写**；预约/提纲/转写回流属 06-itv。

### `getWorkflowOrchestration` / `switchWorkflowTemplate` / `saveAsOrgTemplate`

```
UC: 读工作流编排
  in:  { projectId }
  out: { template: {id, name, sourceVersion}, stageChain: AgendaStageInstance[], matrix: OrchestrationCell[] }
  pre: 调用者对该项目可见
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE

UC: 换工作流模板
  in:  { projectId, templateId, confirmed: boolean }
  out: { impact: {droppedCells:int, affectedTasks:int, lostStages: StageRef[]} , applied: boolean }
  pre: 调用者对该项目有写权限
  err: TEMPLATE_SWITCH_NEEDS_CONFIRMATION | TEMPLATE_SWITCH_FORBIDDEN_AFTER_START
     | NO_PROJECT_ROLE | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE

UC: 另存为组织模板
  in:  { projectId }
  out: { workflowTemplateId }        // 产物是**工作流模板**，不是新蓝本（O-02）
  pre: 调用者对该项目有写权限
  err: NO_PROJECT_ROLE | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```
⚠ `confirmed: false` ⇒ 必须先返回 `impact` 并要求确认，**不得静默替换环节链或丢弃已生成待办**（A5 / V9f）。
⚠ **[待人类裁决]** 具体处置策略与「项目已开始后是否禁止换」未定（domain D-11）——
`TEMPLATE_SWITCH_FORBIDDEN_AFTER_START` 是为该裁决预留的码，**当前不应触发**。
⚠ `saveAsOrgTemplate` **不需要蓝本维护者审核**（它没有改动定义层）；它与 UC-2.3 是两条不同路径。

### `updateMatrixCell` —— 议程环节 × 角色编排格

```
UC: 编辑矩阵格
  in:  { projectId, agendaStageId, roleKey, content, bindings?: {canvasTemplateId?, skillIds?} }
  out: { cellId, syncedTaskIds: TaskId[] }
  pre: 调用者对该项目有写权限；roleKey ∈ 角色表派生的列集（不硬编码，I-28）
  err: NO_PROJECT_ROLE | ROLE_INSUFFICIENT | UNKNOWN_ROLE_KEY
     | TASK_SYNC_FAILED | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
⚠ 字段名写全 `agendaStageId` / `agenda_segment_id`，**禁止裸 `stage`**（D-03）。
⚠ 「绑定」列与 UC-3.2 读写**同一份数据**（I-25），不是两份副本。

### `syncMatrixToTasks` —— 🔗 跨模块契约（F27 的核心）

```
UC: 矩阵格同步为待办
  in:  { projectId, cellIds?: CellId[], idempotencyKey }
  out: { created: TaskId[], updated: TaskId[], removed: TaskId[] }
  pre: 任务模块可用
  err: TASK_SYNC_FAILED | DEPENDENCY_UNAVAILABLE
```
⚠ **格 ↔ 待办卡是可追溯的一一对应**（I-23）：改格联动更新、删格不留孤儿卡、重试幂等不产生重复卡。
⚠ 生成的待办**负责人恒为人**（该格对应的角色），agent 记「执行者」（D-39 / I-26）。
⚠ 同步失败**必须可见并可重试**，不得出现「格子已填但任务里没卡」的静默不一致（E3）。
⚠ **[待人类裁决]** 一格是一条待办还是可含多条（domain D-10）——
这条直接决定「3×3 = 恰好 9 条」这个断言成不成立。

### `setAgendaStageStatus` —— 🔗 三视角首屏的唯一驱动源

```
UC: 切换议程环节状态
  in:  { projectId, agendaStageId, status }
  out: { current: AgendaStageInstance }
  pre: 调用者是组长或引导师
  err: NO_PROJECT_ROLE | ROLE_INSUFFICIENT | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
⚠ 三种视角首屏**同时**切到新环节，且读的是**同一个状态源**（I-24 / V9c）——
不得各视角各自判断当前议程环节。

---

## 四、回流层用例（UC-2.3，整份为 [Backlog] 口径）

> ⚠ **整份 UC-2.3 在原型里的全部证据只有一句话**：「写入的是默认值。引导师在那一场里改，
> 不会回写蓝本；要沉淀就在复盘里『提交回蓝本』。」——它只定死了**入口路径**。
> 主流程与两条规则逐字出自 `Backlog Use Case.html`，**原型运行态没有任何对应界面**。

### `computeDeviations` —— 偏离 diff

```
UC: 算本场偏离
  in:  { projectId }
  out: { deviations: [{configItemKey, beforeValue, afterValue}] , baseVersionId }
  pre: 调用者是该项目的引导师
  err: NO_PROJECT_ROLE | ROLE_INSUFFICIENT | NO_DEVIATIONS | DEPENDENCY_UNAVAILABLE
```
- diff 基准 = **项目绑定的蓝本版本快照**，**按配置项定义表逐项遍历**（不硬编码 16）。
- 议程环节的增删改归到第 2 项「流程 Agenda」名下。
- 未改动项**不出现**在清单里（V2）。
- `NO_DEVIATIONS` ⇒ 真实空态，**不强行凑条目**（A3）。
- ⚠ **[待人类裁决]** 是否覆盖矩阵**格级**改动、粒度到格还是环节行（domain D-14）。

### `submitBlueprintChangeRequest` —— 提交 ≠ 生效

```
UC: 提交回蓝本
  in:  { projectId, selections: [{configItemKey, rationale}] }
  out: { changeRequestIds: string[] }
  pre: 调用者是该项目的引导师；每条 rationale 非空
  err: RATIONALE_REQUIRED | NO_PROJECT_ROLE | ROLE_INSUFFICIENT
     | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
⚠ **不直接改蓝本内容、不生成新版本**（I-10 / V3）：只新增 pending 记录。
⚠ 每条携带**来源项目 + 时间 + 提出人 + 理由 + 原值/新值**（AC1 四要素，缺一即失败）。
⚠ 未勾选的偏离项**不产生任何蓝本侧记录**。
⚠ 提出人须被明确告知「已提交，等待 <维护者> 审阅」，**不得让他误以为已生效**（A1）。

### `listPendingChanges` / `mergePendingChange` / `rejectPendingChange`

```
UC: 看待审改动
  in:  { blueprintId }
  out: [{changeRequest, siblingsOnSameKey: ChangeRequest[]}]   // 同一处多场改动**并排**
  pre: 调用者对该蓝本可读
  err: BLUEPRINT_NOT_FOUND | NO_ORG_ROLE | DEPENDENCY_UNAVAILABLE

UC: 合并一条待审改动
  in:  { changeRequestId }
  out: { blueprintDraftUpdated: true, traceable: {sourceProjectId, proposedBy, proposedAt, rationale} }
  pre: 调用者是**蓝本维护者**   ← ⚠ [待人类裁决] 维护者的定义未定（domain D-1）
  err: NOT_BLUEPRINT_MAINTAINER | CHANGE_REQUEST_STALE | BLUEPRINT_NOT_FOUND
     | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```
⚠ **只有蓝本维护者能合并**——含**提出回提的引导师本人**在内的非维护者调用一律拒绝**并写审计**（V5）。
⚠ 同一处被多场改过时**并排显示各自理由**，**不自动择一、不按时间覆盖**（I-12 / V6）。
⚠ 接受后改动进入蓝本**草稿**，发布仍走 `publishBlueprintVersion` 的两道门槛。
⚠ 合并后蓝本字段必须**可反查到来源项目 + 提出人 + 时间 + 理由原文**，四者缺一即失败（AC1 / V1）。
⚠ 基准版本已过时 ⇒ `CHANGE_REQUEST_STALE`，**不自动失效**，由维护者判断是否仍适用（R7）。

---

## 五、端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `BlueprintRepository` | blueprints / blueprint_versions / config_item_values | PostgreSQL（RLS 强制） |
| `ConfigItemDefinitionRepository` | **定义表**（分母 + `required` 的唯一事实源） | PostgreSQL（迁移即数据） |
| `ProjectPrepRepository` | 项目侧实例：议程环节实例 / 分组 / 对象表 / 定题 | PostgreSQL |
| `OrchestrationRepository` | 矩阵格与绑定 | PostgreSQL |
| `TaskSyncPort` 🔗 | 矩阵格 → 待办的幂等同步 | 11-board（跨模块，transactional outbox） |
| `AgendaStageStatusPublisher` 🔗 | 环节状态变更广播给三视角 | 实时通道（WS，不可用时降级轮询并显示「非实时」） |
| `ModelGatewayPort` 🔗 | 按 lane 路由 + 配额计量 + 降级 | 20-model 网关（机密硬路由在网关侧也要拦，不只在前端选择） |
| `AuditWriter` 🔗 | 审计事件 append-only | 与 phase-00 `artifact` / `identity` **同一个写入面** |
| `ChangeRequestRepository` | 待审改动 | PostgreSQL |

⚠ `ModelGatewayPort` 的机密硬路由**不能只是应用层不去选云端模型**——网关侧必须能独立拒绝
（I-21），否则任何一条绕过蓝本策略的调用路径都会让这条不变量失效。
