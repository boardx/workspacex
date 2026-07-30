# 契约束 `chat` — ② 用例接口与失败模式（签核面第 ② 件）

> **这一件回答的问题**：application 层向外暴露哪些端口，**每个端口会怎么失败**。
> 「失败长什么样」是契约的一半——界面的异常态全靠它渲染。
> ⚠ 只写 happy path 的契约是不完整的契约（`contract-design.md` §五-5）。
>
> 覆盖 feature 见 `design-signoff.md` frontmatter 的 `covers:`（**权威**）。
> 不变量编号 `I-n` 指向本束 [`domain.md`](./domain.md)。
> 第 ③ 件（zod 单源）落点：`packages/contracts/src/chat.ts`（**尚未创建**，签核后开工的第一件产出）。

## 通用约定

**每一个读端口都先过 `resolveVisibility`**（UC-0），没有例外。
下面各用例的 `err` 里凡出现 `NOT_VISIBLE`，都指 UC-0 的统一拒绝形状：
**与「资源不存在」逐字节相同**（I-3），内部记 `deniedLayer`。

**跨束委托**（不在本束实现，只调用）：
- 角色枚举与两层判定中间件 → phase-00 `identity`（`uc-0-3`）
- 三模式绑定 / 定版 / 引用资格门 → phase-00 `artifact`（`bindToProjectStep` / `pinVersion` / `referenceForDownstream`）
- Context Pack 取用 → phase-00 `context-pack`（Context API）
- 模型 / 单价 / 用途策略 → `agent-runtime`（model registry）
- 后台任务 → 11-task

---

## 零、可见性判定（F108 · uc-8-5）

```
UC-0: 判定一次对话读取的可见性
  in:  { actorId, projectId, threadId?, resourceKind: "thread"|"message"|"transcript"|"file" }
  out: { allowed: boolean, scope: VisibilityScope, decisionId, deniedLayer?: "organization"|"project" }
  pre: 无（本身就是前置）
  err: AUTHZ_UNAVAILABLE
```
⚠ **`AUTHZ_UNAVAILABLE` 一律拒绝，不得降级为放行**（uc-8-5 V10）。这是本束唯一
「依赖失败时不给安全重试而直接拒绝」的端口——把它写成「重试期间先放行」就是安全事故。

```
UC-1: 读线程详情（含四视角投影）
  in:  { actorId, threadId, viewAs?: ProjectRole }   # viewAs 仅预览手段，生产构建下不可达
  out: { thread, messages[], rightTabs[], capabilities[] }
       # 观察者：响应体中不存在 rawTranscript / 私聊消息 / 任何写能力标记（I-5）
  pre: 两层交集通过（I-2）
  err: NOT_VISIBLE | THREAD_ARCHIVED_READONLY | AUTHZ_UNAVAILABLE | ROLE_REVOKED_MIDFLIGHT
```
失败模式：
- **越权**：跨组（I-6）、私聊非三方（I-7）、草稿产出非创建者（I-36）→ 全部 `NOT_VISIBLE`。
- **权限撤回中**（uc-8-5 V11 / 各 UC E3/E4）：判定与下发之间角色被撤 → `ROLE_REVOKED_MIDFLIGHT`，
  **立即终止后续写操作**，已完成步骤按审计规则保留，未提交输入留本地草稿。
- **部分成功**：右栏某个标签的数据源失败 ⇒ 该标签标依赖失败，**其余标签仍返回**，
  且计数不得伪装成 0（否则违反 I-20 的「计数与列表长度一致」）。
- **依赖失败**：转录服务不可用 ⇒ 转录标签置空并标失败，**不影响其余四标签**。

```
UC-2: 管理员审计读
  in:  { adminId, projectId, threadId, layer: "project"|"personal" }
  out: layer=project  → { messages[], auditEventId }        # 返回内容（不是 403）
       layer=personal → { itemCount }                        # 只返计数，无正文
  pre: 组织角色 = 管理员（**不要求持有项目角色**，O-04）
  err: NOT_ORG_ADMIN | AUDIT_SINK_UNAVAILABLE
```
⚠ `AUDIT_SINK_UNAVAILABLE`：**写不下审计就不给内容**——「可读」与「必留痕」是同一个原子动作，
不允许出现「读到了但没留痕」。这是 I-8 的并发/部分成功出口。

```
UC-3: 给观察者授予临时读权
  in:  { grantorId, observerId, scopeRef, expiresOn: "stage-end" }
  out: { grantId, auditEventId }
  pre: 授予者为引导师
  err: NO_PROJECT_ROLE | INVALID_GRANT_SCOPE | AUDIT_SINK_UNAVAILABLE
```
失败模式：**幂等重放**——同一 `(observerId, scopeRef, stageId)` 重复授予返回同一 `grantId`，
不叠加有效期。**自动失效**：环节结束后同一请求被拒（uc-8-5 V7）。
⚠ 「环节结束」的触发点未定，见 `domain.md` 待裁决第 10 条。

---

## 一、线程列表与生命周期（F109 · uc-8-1）

```
UC-4: 列出线程（今天/本周分组）
  in:  { actorId, projectId, filter?: "all"|"project"|"my-agents", includeArchived?: boolean }
  out: { groups: [{ label: "今天"|"本周", cards: ThreadCard[] }] }
       # ThreadCard: { id, title, subtitle, badges[], agentSummary, lastActivityAt, visibilityScope }
  pre: 过 UC-0
  err: NOT_VISIBLE | AUTHZ_UNAVAILABLE
```
- **同一结构两场景复用**（AC1）：研究阶段与现场分组返回**完全一致的字段结构**，只有数据不同。
- **空态**：无线程返回 `groups: []`，**不生成示例线程**（V4）。
- **不泄露**：无可见对话时不得泄露「存在但不可见」的条目数（uc-8-5 V9）。
- 归档线程默认不返回（I-15）。
- ⚠ 「更早」分组无契约（待裁决第 11 条），本端口**只返回今天/本周两组**。

```
UC-5: 新建 / 改名 / 删除线程
  in:  create { actorId, projectId, groupId?, title, visibilityScope }
       rename { actorId, threadId, title, expectedVersion }
       delete { actorId, threadId, expectedVersion, reason }
  out: { threadId, version, auditEventId, impactScope? }
  pre: 项目角色具备写权限；观察者恒无（其按钮不渲染且接口拒绝）
  err: NOT_VISIBLE | NO_WRITE_ROLE | VERSION_CHANGED | THREAD_ARCHIVED_READONLY
     | TITLE_INVALID | AUDIT_SINK_UNAVAILABLE
```
失败模式：
- **并发**（V7）：两人同时改名/删除同一线程 ⇒ 乐观并发 `expectedVersion` 不匹配即 `VERSION_CHANGED`，
  **不静默覆盖**，且最终版本可识别。
- **幂等重放**：同 `expectedVersion` 的重复 delete 返回同一 `auditEventId`，不产生第二条审计。
- **删除是可追溯动作**：返回 `impactScope`（影响范围），审计必写。
- **越权尝试也要有安全审计记录**（V8）。

```
UC-6: 取线程的 messages.jsonl（file-first）
  in:  { actorId, threadId }
  out: { objectKey, sha256, sizeBytes, downloadUrl }
  pre: 过 UC-0（**与线程同一套 acl_bindings**，I-12）
  err: NOT_VISIBLE | FILE_NOT_MATERIALIZED | STORAGE_UNAVAILABLE
```
⚠ 这个端口存在的意义就是**证明文件浏览器不是权限旁路**。它的越权断言与 UC-1 必须**同源**——
若它自己判一次权，就是第二份可见性实现。

---

## 二、AI 团队与消息流（F110/F113 · uc-8-2）

```
UC-7: 读 AI 团队面板
  in:  { actorId, threadId }
  out: { agents: [{ id, abbr, name, duty, presence }], presentCount, rosterCount, marketEntry }
  pre: 过 UC-0
  err: NOT_VISIBLE | AGENT_REGISTRY_UNAVAILABLE
```
- `presence` 三值封闭、`duty` 非空（I-17）；两个计数分离（I-18）。
- **依赖失败**：agent 注册表不可用 ⇒ 返回错误而**不是返回空面板**（空面板会被读成「没有 agent」）。

```
UC-8: 改本线程的 agent 编制
  in:  { actorId, threadId, add: agentId[], remove: agentId[], expectedRosterVersion }
  out: { rosterVersion, agents[], auditEventId }
  pre: 项目角色具备编制权；被加入的 agent 在**可加入范围**内
  err: NOT_VISIBLE | NO_WRITE_ROLE | AGENT_OUT_OF_SCOPE | VERSION_CHANGED
     | AGENT_NOT_FOUND | AUDIT_SINK_UNAVAILABLE
```
⚠ **`[编制]` 在原型里是空按钮**（uc-8-2 R3 步骤 2 [原型待补]）。本端口的形状是 `[设计]`。
- **部分成功**：`add` 里有一个越范围 ⇒ **整体拒绝**，不做「加进去 2 个、拒了 1 个」的半成品。
- 编制变更是**五类审计事件**之一（V18）。

```
UC-9: 读消息流
  in:  { actorId, threadId, cursor?, limit }
  out: { messages: [{ id, authorKind, agentId, skill, thinkingSummary, badges[], citations[],
                      toolCallSummary?, card? }], nextCursor }
  pre: 过 UC-0
  err: NOT_VISIBLE | AUTHZ_UNAVAILABLE
```
- **必须分页/增量**（R9），禁止一次加载整个项目历史。
- **空态**：新线程返回 `messages: []`，**不生成示例对话**；右栏五标签计数全 0 且**不隐藏标签**（V14）。
- `badges` 标在**发生它的那条消息**上，不折叠进别处（AC5）。

```
UC-10: AI 主动发言
  in:  { threadId, agentId, trigger }
  out: { emitted: false, reason: "no-source" } | { emitted: true, messageId }
  pre: 该 agent 的主动插话开关为开
  err: CONTEXT_API_UNAVAILABLE
```
⚠ **取不到来源时是「正常返回但不发言」，不是错误**（I-19 / V6）。
把它做成 `throw NO_SOURCE` 会让上游 catch 住之后「兜底发一条」——那正是要防的。
- 关闭该 agent 主动插话后，同场景下它只在被 `@` 时发言（A5）。

```
UC-11: 读右栏五标签
  in:  { actorId, threadId, phase }
  out: { tabs: [transcript, execution, insight, artifact, material] }   # 恒五个
  pre: 过 UC-0
  err: NOT_VISIBLE | 各标签独立的依赖失败（不整体失败）
```
- 研究阶段：转录标签隐藏或置空，默认落在「材料」（E1）。
- 观察者：转录卡与批准卡不在响应体里（I-5）。

```
UC-12: 改派建议
  in:  { threadId, messageDraft }
  out: { suggested?: { agentId, reason } }     # reason 恒非空（I-21）
  pre: 过 UC-0
  err: —（无建议时返回空对象，不是错误）
```

```
UC-13: 转录卡控制（停止录音 / 读实时文字）
  in:  { actorId, threadId, action: "stop" }
  out: { transcriptSessionId, elapsedSeconds, stoppedAt }
  pre: 非观察者（观察者该能力标记根本不在响应体里）
  err: NOT_VISIBLE | NO_WRITE_ROLE | TRANSCRIPT_SERVICE_UNAVAILABLE | ALREADY_STOPPED
```
- 计时必须是**真实录制时长**，不是页面计时器。
- `ALREADY_STOPPED` 是幂等出口：重复 stop 不报错、返回同一 `stoppedAt`。

---

## 三、工具调用链与引用（F111 · uc-8-2）

```
UC-14: 展开工具调用链
  in:  { actorId, messageId }
  out: { summary: { callCount, readVolume, tokens },
         calls: [{ function, args, hitCount?, reuseFlag?, status, tokens,
                   callerAgentId, model, pipelineVersion, provenanceEventId }] }
  pre: 过 UC-0
  err: NOT_VISIBLE | PROVENANCE_UNAVAILABLE
```
- **是 `provenance_events` 的投影**：`calls.length === provenanceEvents.length`（I-22）。
  **不另建调用日志表**——两套会漂移。
- **失败条不隐藏**（I-25）：`summary.callCount === calls.length` 恒成立，
  失败条带原因，基于它的结论标 `incomplete`。
- **运行中**：`status: "running"` 是正常返回值，不是 pending 错误。
- ⚠ **append-only 反证**：尝试修改任一 `provenanceEventId` 对应的记录必须被拒（I-23）。

```
UC-15: 定位一条引用
  in:  { actorId, citationId }
  out: { index, sourceFullName, anchor: {kind:"page"|"transcript"|"message", ...}, locatable: true }
  pre: 过 UC-0（**取来源与目标中更严格的可见性**，I-11）
  err: NOT_VISIBLE | ANCHOR_UNRESOLVABLE | SOURCE_ARTIFACT_DELETED
```
⚠ `ANCHOR_UNRESOLVABLE` 不是「暂时找不到」——它意味着**这条引用不合格**（I-24），
上游若正在定版则定版必须被拒（见 UC-20）。

```
UC-16: 重放某轮的 Context Pack
  in:  { actorId, agentRunId }
  out: { contextPackId, items[], omissions[] }
  pre: 过 UC-0
  err: NOT_VISIBLE | PACK_NOT_RECORDED | CONTEXT_API_UNAVAILABLE
```
⚠ `omissions[].reason` 的七类枚举**不由本束定义**（S-12，属 `context-pack` 束）。

---

## 四、批准闸门（F112 · uc-8-2）

```
UC-17: 触发一个高影响动作 → 产生批准请求
  in:  { threadId, agentId, action, dataScope[], proposedModels[], estimatedTokens }
  out: { requestId, status: "paused", callChain[], models[], budget{tokens,amount,currency},
         dataScope[{name,confidential}], exits: ["approve","reparam","decline"],
         expiresAt, backgroundHint }
  pre: 该动作被判为高影响（**判定表是外部输入**，本束只呈现结果）
  err: MODEL_POLICY_VIOLATION | REGISTRY_UNAVAILABLE | BUDGET_EXHAUSTED | RISK_TABLE_MISSING
```
- **动作零副作用**（I-27）：`paused` 期间目标系统无任何写入。
- **六项披露全非空**（I-28），缺一即失败。
- `MODEL_POLICY_VIOLATION`：**含机密时的模型约束在服务端拒绝**，不是界面提示（I-32）。
  🔴 判定口径待裁决（`domain.md` 第 1 条），裁决前不得写死。
- `REGISTRY_UNAVAILABLE`：model registry 不可用 ⇒ **不出卡**。
  ⚠ 不得回落到硬编码价目「先让卡显示出来」——那会做出 I-31 的反例。
- `BUDGET_EXHAUSTED`：预算达 100% ⇒ 转「等待输入」求追加预算，
  **既不硬停也不继续执行**（O-36 / V4b）。这是一个**状态**，不是终止。

```
UC-18: 走三个出口之一
  in:  approve { actorId, requestId, expectedStatus: "paused" }
       reparam { actorId, requestId, expectedStatus, newModels[], newBudget, newDataScope[] }
       decline { actorId, requestId, expectedStatus }
  out: approve → { taskId, etaMinutes, auditEventId }      # 转后台任务，线程不阻塞
       reparam → { newRequestId, supersedesRequestId, auditEventId }
       decline → { auditEventId }
  pre: 请求处于 `paused`；操作者有批准权
  err: NOT_VISIBLE | NO_APPROVAL_ROLE | APPROVAL_STATUS_CHANGED | APPROVAL_EXPIRED
     | MODEL_POLICY_VIOLATION | TASK_QUEUE_UNAVAILABLE | AUDIT_SINK_UNAVAILABLE
```
失败模式（**这一段是产品的信任核心，必须逐条有独立断言**）：
- **并发**（V17）：两人同时点批准 ⇒ 只有一个生效，另一个 `APPROVAL_STATUS_CHANGED`（I-29）。
- **幂等重放**：同一 `(requestId, expectedStatus)` 的重复 approve 返回**同一 `taskId`**，
  **不得产生第二个后台任务**（否则「批准一次执行两次」）。
- **超时/归档**（E1e / V4）：过期后调批准接口被拒，状态 `已过期 · 未执行`，
  **不得静默执行**。默认时限现场 5 分钟 / 非现场 24 小时（O-36，可配）。
- **改参不就地改写**（I-30）：生成新请求，原请求存档为「已改参」，字节不变。
- **`decline` 后动作永不执行**，并记审计。
- **部分成功**：批准成功但入队失败 ⇒ `TASK_QUEUE_UNAVAILABLE`，
  请求**留在 `paused`**（不能转 approved），否则会出现「已批准但没有任务」的无主状态。
- **界面断连不得导致任务丢失或重复执行**——服务端 run/event 是权威，
  CopilotKit / AG-UI 只是 presentation protocol（uc-8-2 R7 编排边界）。

```
UC-19: 查后台任务回流
  in:  { actorId, taskId }
  out: { status: "queued"|"running"|"needs-input"|"done"|"failed"|"cancelled", resultMessageId? }
  pre: 过 UC-0
  err: NOT_VISIBLE | TASK_NOT_FOUND | TASK_QUEUE_UNAVAILABLE
```
⚠ 节点恢复时**副作用必须幂等**（LangGraph `interrupt()` 的 HITL 恢复语义）。

---

## 五、产出落地（F114 · uc-8-3）

```
UC-20: 把一条结论 / 产物卡落地为 Artifact
  in:  { actorId, threadId, messageId, mode: "draft"|"live"|"pinned", title, payloadRef }
  out: { artifactId, versionId?, contentHash?, mode, hasSource,
         provenanceBacklink: { conversationId, messageId, citations[] } }
  pre: 出处回链三项非空（I-33）；mode=pinned 还要求**100% 引用可定位**
  err: NOT_VISIBLE | NO_WRITE_ROLE | MISSING_PROVENANCE_BACKLINK
     | CITATION_UNRESOLVABLE_REQUIRES_DRAFT | STUDIO_RUN_NOT_FOUND
     | VERSION_CHANGED | STORAGE_UNAVAILABLE | AUDIT_SINK_UNAVAILABLE
```
- **机制委托**（D-38）：三模式绑定与定版调 phase-00 `artifact` 的
  `bindToProjectStep` / `pinVersion`。**本束不另立版本机制。**
- **三模式选择必须并列展示各自后果**（能不能被决策引用 / 会不会随源变动），
  不是三个裸单选按钮（R3 步骤 3）。
- `CITATION_UNRESOLVABLE_REQUIRES_DRAFT`：有任一引用不可定位 ⇒ **只能落草稿，不得定版**（V4d）。
- **并发定版**（V9）：两人同时定版只产生一个新版本号，另一方 `VERSION_CHANGED`。
- **部分成功**：Artifact 已建但绑定失败 ⇒ 整体回滚或落 `draft`，
  **不得留下一个绑不上的孤儿产出**。

```
UC-21: 引用资格门（下游要用这条产出）
  in:  { actorId, artifactId, purpose: "report-final"|"submit-acceptance"|"decision-evidence"|"write-back-kg" }
  out: { allowed: true, versionId }
  pre: —
  err: REQUIRES_PINNED | REQUIRES_ACCEPTANCE | NOT_VISIBLE | SNAPSHOT_IMMUTABLE
```
⚠ **这个门必须是 phase-00 `artifact` 的 `referenceForDownstream` 那一个**（I-34），
对话侧**不自己判「是不是快照」**。四个 purpose × 三种 mode 的 12 格矩阵是它的验收面。
`REQUIRES_ACCEPTANCE`：定版是**必要不充分**条件——需验收的产出还须过 UC-13.2。

```
UC-22: 读右栏「产物」列表
  in:  { actorId, threadId }
  out: { items: [{ artifactId, title, mode, version?, pinnedBy?, pinnedAt?, hasSource }] }
  pre: 过 UC-0（**草稿仅创建者可见 → 其余 404**，I-36）
  err: NOT_VISIBLE
```
- **空态**：无产出时计数为 0 且显示真实空态，**不生成伪产出**（V7）。
- **依赖失败**（V8）：报告/图谱服务失败时**产出与其绑定关系不变**，错误可解释可重试。

---

## 六、预设对话（F115 · uc-8-4）

⚠ **本节全部形状来自 `[Backlog]` 文档，无任何原型证据**（见 `domain.md` 待裁决第 12 条）。

```
UC-23: 创建 / 编辑预设
  in:  { actorId, projectId, openingPrompt, skills[], agents[], expectedVersion? }
  out: { presetId, version }
  pre: 引导师
  err: NO_PROJECT_ROLE | VERSION_CHANGED | PRESET_PREAPPROVAL_FORBIDDEN
     | PRESET_SCOPE_BYPASS_FORBIDDEN
```
- `PRESET_PREAPPROVAL_FORBIDDEN`：**预设不得预先批准任何高影响动作**（I-41）。
- `PRESET_SCOPE_BYPASS_FORBIDDEN`：不得预置绕过权限或同意位的检索范围（O-05）。
- 预设定义按 `artifact_versions` 管理、**不可变**；编辑生成新版本。

```
UC-24: 下发预设
  in:  { actorId, presetId, targets: { plenary?: true, groupIds?: [], roles?: [] } }
  out: { dispatchId, targetCount }
  pre: 引导师；预设引用的 agent/skill 在**下发对象的可见性范围内**
  err: NO_PROJECT_ROLE | AGENT_OUT_OF_SCOPE | SKILL_OUT_OF_SCOPE | PRESET_NOT_FOUND
     | VERSION_CHANGED
```
- **越范围在下发接口即拒绝，不是下发后失败**（I-40）；错误须标明是**组织层**还是项目层限制。
- **原子性**：拒绝时**不得已经创建部分实例或发出部分通知**。
- **幂等重放**：同一 `(presetId, targets, version)` 重复下发返回同一 `dispatchId`。

```
UC-25: 开始一个预设实例
  in:  { actorId, presetId }
  out: { threadId, instanceId }     # 打开即带好开场提示、agent 与 skill，无需任何配置动作
  pre: 该用户在下发对象内
  err: NOT_DISPATCHED_TO_ACTOR | PRESET_VERSION_SUPERSEDED | AGENT_OUT_OF_SCOPE
```
- 实例是**各人私有的对话**，可见性由 UC-0 判定（I-39）。
- 实例**继承 uc-8-2 全部规则**（主动发言必带来源、高影响动作走批准卡）。
- **并发**：同一人重复点「开始」⇒ 幂等返回同一 `instanceId`，**不产生两个实例**
  （否则使用计数 I-38 会被刷高）。

```
UC-26: 读预设使用计数
  in:  { actorId, presetId }
  out: { usageCount }        # = 真实实例数，不按下发人数估算（I-38）
  pre: 过 UC-0
  err: NOT_VISIBLE | PRESET_NOT_FOUND
```

---

## 七、审计（横切，F108–F115）

```
UC-27: 检索对话侧审计事件
  in:  { actorId, projectId, filter: { actor?, triggerAgent?, timeRange?, objectRef?, result? } }
  out: { events: [{ id, type, actor, triggerAgent?, at, objectRef, result, impactScope }] }
  pre: 具备审计查询权（项目负责人 / 管理员）
  err: NOT_VISIBLE | AUDIT_QUERY_UNAVAILABLE
```
必须可检索的事件类型（**五类 + 三类，来自 uc-8-2 V18 / uc-8-1 V8 / uc-8-3 V10 / uc-8-5 V12**）：
批准 · 改参 · 拒绝 · 每次工具调用 · agent 编制变更 · 新建/改名/删除线程 ·
落地/定版/绑定/解绑 · 越权尝试 · 观察者单独授权 · 管理员审计访问。

⚠ **越权尝试也必须有安全审计记录**——四份 UC 各自重复写了这一条。
⚠ 这个查询面**跨束**（见 `design-signoff.md` X-2）：与 phase-00 `artifact` / `identity` 的
`queryProvenance` **必须是同一个查询面**，不得各造一个。
