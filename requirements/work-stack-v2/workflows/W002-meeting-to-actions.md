# W002 — Meeting-to-Actions（会议到行动）

> 类型：Reference Workflow · 域：Shared · 作者化任务：AUTHOR-W002 · 状态：PASS
> **代码基线**：`main@30c1c4332025151610502988b0379b95ff7298c7`。标 **VERIFIED@30c1…** 的陈述在该 SHA 下读过文件；未读到证据的标 **UNVERIFIED**；基线上不存在/未接线的能力标 **proposed-unwired**。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时：ADR-118（第 5 条实例固定版本、第 6 条 effect-gateway、第 7 条触发器、第 9 条 Skill 由 Workflow 固定）；工具分类：ADR-120；评测门：ADR-119。
> 对齐的已 PASS 契约（只引用、不修改）：`skills/S006-meeting-summary.md`、`skills/S142-work-item-management.md`。`skills/S017-task-extraction.md`（`reviews/S017.review.md` Verdict: PASS）与 `skills/S007-status-update.md`（`reviews/S007.review.md` Verdict: PASS）同样按其 PASS 版对齐，仍待接口请求的依赖点列在 §13。

## 1. 边界
把**一场已经结束、且有可引述材料的会议**，变成：① 一份经人确认的纪要 `MeetingRecord`；② 看板上**经人逐条批准**、有真人 owner 的卡；③ 在跟踪期内按期生成、只回给作者的行动项状态草稿。
W002 的终点不是「纪要写完」，而是「会上的承诺都有了着落：要么成卡、要么被人明确放弃、要么以『待定 owner / 待决议』的形式显式挂起」。

W002 **不做**：会前准备（S005，属 W012/W013 等）；销售会议到商机（W013 用 S005/S028）；任何无人批准的对外发送；把「会上提到某人」变成该人的任务（S006 M5、S142 决策 2）。

## 2. 组合图（精确 ID，来自两张矩阵，原样）

### 2.1 参与 Skill（`WORKFLOW-SKILL-MATRIX.md` 第 8 行：`W002 | Meeting-to-Actions | Shared | S006, S017, S142, S007`）
| Skill | 在 W002 中的唯一职责 | 模式 / 入参 | 引用的对方契约 |
|---|---|---|---|
| S006 Meeting Summary | 从转写/笔记产出 `MeetingRecord`：七值决议状态、承诺候选原话锚点、敏感度与内容发起请求隔离 | `material.kind ∈ {recording-session, attachment-transcript, notes}` | S006 §5 M1–M8、§7、I1–I9、决策 1/2/4/6 |
| S017 Task Extraction | 把 `commitmentCandidates[]` 规范成 `TaskCandidateSet`（交付物、承诺强度、决议门、`DueExpression`） | `mode: "meeting-commitments"`，`upstreamSchemaVersion: "S006@2"` | S017 §6、§7、J1–J12（含 J3b；J12：decision-superseded 排除） |
| S142 Work Item Management | 与看板现有卡逐条对照，产出 `WorkItemChangeSet`（create/transition/merge-suggestion/noop-duplicate/needsOwner） | `mode: "materialize"` | S142 §5.1–5.2、§7、O1–O8、§8、§10 |
| S007 Status Update | 跟踪期内对已建卡生成行动项状态草稿（规则定色、`author-only`） | `updateKind: "action-items"` | S007 §4、§5、§6 SR-A*（PASS） |

Skill 版本由 `WorkflowDefinition(W002, v1).stages[*].skills[*] = {stableId, versionRange}` 在启动时解析并冻结（ADR-118 第 5 条）。运行 W002 的 Agent **不需要**挂载这四个 Skill（ADR-118 第 9 条）；只需在其 `workflowAllowlist` 中允许 W002 v1。S006 的 `versionRange` 固定为 `^2.0.0`（S006 决策 5：WX-S009 升 2.0.0，1.x 的输出带 owner/due，与 S017 输入 `S006@2` 不兼容）。

### 2.2 消费者（`DIGITALHUMAN-COMPOSITION-MATRIX.md` 中 Exact Workflows 含 W002 的行，共 4 个）
| DigitalHuman | 矩阵行 | Workflows 列（原样） | 在 W002 中通常的发起场景 |
|---|---|---|---|
| D006 Customer Success Specialist | 第 12 行 | W007, W017, W018, W002, W006 | 客户例会（`meetingType=customer-external`），承诺有 us/them 两边 |
| D007 Project / Operations Manager | 第 13 行 | W052, W053, W055, W056, W002, W003 | 项目周会、评审会（`project-review` / `internal-working`） |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | 工作坊（录音 `sourceType=workshop`） |
| D015 Agile / Product Operating Model Coach | 第 21 行 | W030, W032, W053, W002 | 回顾会、站会后续 |

这四行 Skill 列只表示聊天直接调用（ADR-118 第 9 条），与 W002 能否运行无关；本文不提任何挂载边。D015 在 G2 上的权限见决策 6。

### 2.3 相邻 Workflow（划界）
- W003 Decision-to-Execution：输入是已定决议（S012），经 S154 拆计划。W002 中 `decisionState=confirmed` 且需拆解的大事项**不在 W002 里拆**，G2 上可标记「转 W003」，W002 只建一张占位卡（owner 为决议拍板人，须人确认）。
- W053 Weekly PMO Review：对看板做 `hygiene-review`。W002 的跟踪（阶段 9）只看**本实例建的卡**，不做全板卫生。
- W006 Knowledge Capture Loop：会议中的知识性结论入库不归 W002。

## 3. 实体特有决策

**决策 1 — 纪要门 G1 按「风险信号」触发，而不是每场会都拦。**
每场会都要求人先审纪要，会让 W002 比手写还慢；但以下信号出现时，S006 的输出若带错进入 S017/S142，就会变成卡片上的错误责任。G1 为 `required` 的条件（任一）：
(a) 存在 `commitmentCandidates[].committer.speakerResolved = false` 的候选（声道未指派，S006 决策 4）；
(b) `unresolvedItems[].reason = "evidence-not-citable"` 非空（有决议只能由不可引述段支撑，S006 M2）；
(c) `metadata.meetingType = "board-or-committee"`；
(d) `sensitivityFlags` 非空；
(e) `contentOriginatedRequests` 非空（转写里有人「要求」发送或建卡）。
否则 G1 为 `none`，直接进 S017。G1 上人能做的只有：确认；去录音模块修正说话人指派/校对段落后**重跑 S006**（产生新 attempt，旧 attempt 保留）；或终止（`record_rejected`）。**人不能在 G1 上直接改 `decisionState`**——决议状态只由 S006 按原话判定，否则纪要与原话的锚定就断了；人若认为判错，走「校对段落 → 重跑」。

**决策 2 — 承诺到卡之间必须有逐条批准的人工门 G2，且 G2 是 `required`，无人值守不可越过。**
S142 决策 1 规定变更集恒为 `proposed-not-applied`；S017 的 `requiresConfirmation`、`decisionGate` 在 S142 中没有接收字段（S017 §14）。因此按 S017 §14，`requiresConfirmation = true` 的条目先在 S017 与 S142 之间的人工门 **G2a**（阶段 5 调用 S142 之前）逐条处理，只有人工确认过的才投影给 S142；S142 之后的 G2 再把 S017 与 S142 的输出**合并展示**：每条 create 提议旁显示对应 S017 候选的 `commitmentStrength`、`decisionGate`、`dueAsStated` 原话与证据段。规则：
- `requiresConfirmation = true` 的条目**不允许**「整批确认」，必须单独勾选；
- `needsOwner` 条目只能由人从 `ownerCandidates` 或成员目录中选定 owner（选定后以 `ownerBasis = "g2-human-assigned"` 记账），**不回落到主持人或 G2 批准人**；
- `decisionGate = "awaiting-decision"` 的条目缺省不建卡，只进 `heldItems`；人可以显式改为建卡，但该卡标题前缀固定为「[待决议]」，`riskLevel` 仍只搬运上游（S142 决策 5）。
- 超时：G2 等待 5 个工作日（按 `workCalendarRef`）无响应 → 终态 `actions_expired`，**不自动建卡**。

**决策 3 — W002 自己提供跨重跑稳定的 origin key，用证据段 id，不用 S017 的 `setId`。**
S142 §10 的「确定重复」依赖 `originRefs`，而 S017 的 `setId = hash(mode, sourceRef.contentDigest, skillVersion)`（S017 §7，不含 workflowRunId；同一输入跨 run 重跑逐字相同）——但转写校对会改变 `contentDigest`，校对后重跑 W002 时 `setId` 随之变化，按 `s017-task` id 查重会重复建卡。W002 规定每张由 W002 建的卡在实例账本（`w002_origin_ledger`，落在 ADR-118 的 `workflow_stage_outputs` 业务行中，**proposed-unwired**）中记录 `originKey = "w002:" + meetingKey + ":" + sort(evidence[].id).join("+")`，其中 `meetingKey = sessionId`（录音）或 `fileId`（附件/笔记，不含 `fileVersionId`）。录音段 id 在校对后保持不变（段是就地改状态的；此点对 `segmentId` 的稳定性 **UNVERIFIED**，E11 验证）。阶段 5 调用 S142 前，W002 把账本中同一 `meetingKey` 的历史 `originKey → taskId` 映射，投影到 `existingItems[].originRefs`（S142 §6 已声明该字段由 Workflow 运行账本提供）为「本次候选的 `s017-task` id」——当且仅当两者 `originKey` 相同。于是 S142 的 M3 origin-ref 命中即为跨实例的确定重复。

**决策 4 — 效果主体是 G2 批准人，不是 Agent，也不是会议组织者。**
`POST /tasks` 以 `@CurrentPrincipal()` 注入主体、仅在 `projectId` 非空时解析项目角色（VERIFIED@30c1…，`board.controller.ts` :102–143）。W002 以 G2 批准人的身份执行全部看板写入；该人必须对 `projectId` 有非 observer 角色（P2）。Agent（官方或组织内）只作为 `executor` 出现在它被显式指派的卡上（S142 决策 2 / D-39）。触发者若是事件（会议结束），在 G2 之前**没有**效果主体——所以 G2 之前的阶段一律无写副作用。

**决策 5 — 没有 `projectId` 的会议不建卡。**
录音会话的 `startRecording` 入参必填 `projectId`（VERIFIED@30c1…，`packages/contracts/src/recording.ts` :362–371），但附件转写与笔记没有。S142 §8 指出 `POST /tasks` 在 `projectId=null` 时不解析任何角色（基线缺口）。W002 规则：`effectiveProjectId` 为空时，阶段 5 不调用 S142，终态 `record_only`；G1/G2 上人可以选一个自己有非 observer 角色的项目后再继续（产生新 attempt）。

**决策 6 — D015 发起的实例，G2 只能由人批准且 D015 的 Agent 不能成为任何卡的 executor。**
D015 是教练角色，S142 §9 预期其 `direct` 模式只提议不执行。W002 中，D015 可以发起、可以在 G2 上给出建议（例如「这条太模糊，建议拆成两件」），但 `executor` 字段禁止为 D015 的 agent id；D006/D007/D011 在 G2 被人显式指派为 executor 时允许。该规则写入 `WorkflowDefinition` 的 `executorDenyList`（**proposed-unwired**），由 P2 检查。

**决策 7 — v1 不含对外发送阶段（无 G3、无 `mail.*`）；客户会议纪要在 v1 中只能 `author-only` 发布。**
S006（PASS）规定外部参会者在场即向 `sensitivityFlags` 写入 `external-attendees`，且 I7 规定 `sensitivityFlags` 非空 ⇒ `distributionHint = author-only`。因此任何以「`customer-external` 且 `sensitivityFlags = []`」为前提的对外发送阶段在构造上不可达；而放宽为「仅 `external-attendees` 时允许发送」就要由 W002 覆盖 S006 I7 的分发结论，等于在 Workflow 里改 Skill 的安全不变量。v1 选择删除原阶段 9 / G3 / `externalFollowUp`，把对外跟进列为 §13 提议 5（需 S006 先定义 `external-attendees` 的受控放行规则，并需参会名单核验与 `mail.*` 能力落地——二者基线均不存在，proposed-unwired）。后果如实写明：D006 的客户例会在 v1 中产出本方看板卡 + `author-only` 纪要（只对 G2 批准人可见）；批准人可自行复制纪要文字对外发送，但那是人在 W002 之外的动作，W002 不产生任何外发效果、不记外发 receipt。转写中的内容发起请求（「抄送 cfo@…」）依 S006 M7/I9 只作为 `contentOriginatedRequests` 在 G1 上只读展示，永不执行。

**决策 8 — 跟踪（S007）是本实例的一部分，但只跟踪本实例建的卡，且输出永远只回给作者。**
S007 §7.1：收件人可见性端口落地前 `clearance = author-only`。W002 不把状态草稿发到群/邮件；跟踪的价值在于让 G2 批准人知道「会上的承诺现在怎样了」。跟踪在 `trackingHorizon`（缺省：最晚一张卡 `dueAt` + 5 个工作日，上限 45 天）结束，或全部卡 `done` 时结束。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts（ADR-118 新建；proposed-unwired，基线不存在）中 W002 的 trigger 输入
const W002Trigger = z.object({
  kind: z.enum(["recording_ended", "manual", "agent_request"]),
  // recording_ended：由录音结束 + 转写物化完成事件触发。基线 endRecording 返回 materializeJobId（VERIFIED@30c1… recording.ts :522–540），
  // 但「物化完成」事件向 workflow 触发器的投递 proposed-unwired（ADR-118 第 7 条：pg-boss 泛化）。
  // 不支持 webhook（外部会议系统 Zoom/腾讯会议/飞书会议的转写推送）：见 §13 提议 3。
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId.nullable(),        // recording_ended 时为 null（无人发起）；manual/agent_request 时为背后的人
  initiatorAgentVersionId: z.string().nullable(),   // 须在 workflowAllowlist 内（ADR-116）
  material: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("recording-session"), sessionId: z.string() }),
    z.object({ kind: z.literal("attachment-transcript"), fileId: z.string(), fileVersionId: z.string() }),
    z.object({ kind: z.literal("notes"), fileId: z.string(), fileVersionId: z.string() }),
  ]),                                         // 与 S006 MeetingSummaryInput.material 同形，原样透传
  projectId: z.string().nullable(),           // recording-session 时由服务端从会话读取，调用方值被忽略
  meeting: z.object({                         // 调用方声明，透传 S006.meeting；服务端不采信为 server-verified
    title: z.string().max(200).optional(),
    scheduledStart: z.string().datetime().optional(),
    meetingType: z.enum(["internal-working", "customer-external", "board-or-committee", "project-review"]).optional(),
    agenda: z.array(z.object({ itemId: z.string(), title: z.string() })).max(30).optional(),
  }).default({}),
  locale: z.enum(["zh-CN", "en-US"]),
  jurisdiction: z.enum(["CN", "US"]).optional(),
  timeZone: z.string(),                       // IANA；透传 S142.timeZone，必填（S142 F5）
  workCalendarRef: z.string().optional(),     // 组织工作日历版本；来源端口 proposed-unwired；缺失 → S142 相对工作日 unresolvable
  supersedesInstanceId: z.string().optional(),// 同一会议材料校对后的重跑（决策 3）
});
```
- **实例幂等键**：`(orgId, meetingKey, materialDigest)`，`materialDigest` = S006 `materialRef.contentDigest` 的预计算（录音为全部 `final` 段文本哈希，附件为 `fileVersionId`）。同一会议同一材料的第二次触发（例如事件重投 + 用户手动点击）返回同一实例；同 `requestId` 不同 payload → `IDEMPOTENCY_KEY_REUSED`。
- `recording_ended` 触发且会话中仍有 `partial` 段时，实例进入 `awaiting_material`，最长等 2 小时（转写尾部物化）；超时仍有 `partial` 段则继续（S006 M2 会把它们排除并计数），不阻塞整场会。

## 5. 阶段表
状态机：`requested → awaiting_material → material_ready → summarizing → summarized → [G1?] → record_confirmed → extracting → extracted → planning → planned → [G2] → approved → applying（逐条 P2） → applied → publishing_record → record_published → tracking ⟲ → 终态`

状态分两类：上式与下表「状态转移」列中的非终态只存在于实例运行期（`instance.stage/state`），不进入产出 schema；终态全部且仅列在 §7，枚举为 `W002Terminal`（§6）。`applied` 是阶段 7 的完成态，不区分全成功/部分失败——每条的成败只由 `applied[].outcome` 表达（W6 末句），不存在 `partially_applied` 状态。

| # | stage | Skill IDs | 工具能力分类（ADR-120，均为提案名） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | intake | —（平台：材料就绪与项目解析） | `recording.read`（proposed-unwired）或 `knowledge.read` | requested → awaiting_material → material_ready ｜ → material_rejected | read | none |
| 2 | summarize | S006 | `recording.read` / `knowledge.read`；optional `audio.transcribe`（`wx_audio_transcribe`，L0） | material_ready → summarizing → summarized ｜ → material_rejected（S006 非重试错误） | read | none |
| 3 | record_review | — | — | summarized → awaiting_record_review → record_confirmed ｜ rerun → summarizing ｜ → record_rejected | none | **G1**：决策 1 条件下 required，否则 none |
| 4 | extract | S017（`meeting-commitments`） | —（纯推理；S017 以 actor 重读 `MeetingRecord`） | record_confirmed → extracting → extracted ｜ 0 候选 → publishing_record（record_only 分支） | read | none |
| 5 | plan | S142（`materialize`） | `board.read`（`GET /tasks?projectId=`，agent 侧工具 proposed-unwired）、`directory.read`（`activeMemberIds`，proposed-unwired） | extracted →（存在 `requiresConfirmation = true` 条目时）awaiting_confirmation → planning → planned ｜ projectId 为空 → publishing_record（决策 5） | read | **G2a**：存在 `requiresConfirmation = true` 条目时 required（决策 2、S017 §14），在调用 S142 之前 |
| 6 | approve_actions | — | — | planned → awaiting_approval → approved ｜ → actions_rejected ｜ 超时 → actions_expired | none | **G2**：required（决策 2），逐条/整批（受限） |
| 7 | apply | S142（`materialize`，以最新 `GET /tasks` 重跑一次，S142 §10） | `board.write`（`POST /tasks`、`PATCH /tasks/:id/status`） | approved → applying（每条写前 P2）→ applied（逐条 outcome 可混合） | write | none（G2 覆盖；每条写前执行 **P2**） |
| 8 | publish_record | — | `artifact.write`（平台内部写） | applied / extracted(0 候选) / extracted(projectId 为空) / actions_rejected / actions_expired → publishing_record → record_published | write | none（G1/G2 覆盖；执行 **P3**） |
| 9 | track | S007（`action-items`） | `board.read`（proposed-unwired）；`notify.inapp`（只发给 G2 批准人） | record_published（仅当存在 `outcome=applied` 的 create）→ tracking →（每个检查点）tracking ｜ → completed ｜ → tracking_expired；无已建卡 → 直接取 §7 对应终态（`record_only` / `actions_rejected` / `actions_expired`） | read | none（输出 author-only，执行 **P5**） |

说明：
- **阶段 1**：`recording-session` 时服务端读会话得 `projectId`（contract 必填，VERIFIED@30c1…）与段状态；agent 侧录音读取工具不存在（S006 §4，proposed-unwired）——在它落地前，W002 的阶段 1/2 只能以平台服务身份读取，并用 S006 §8 的同意矩阵门：未满足 → `material_rejected(reason=S006_CONSENT_NOT_SATISFIED)`。附件/笔记模式经 `wx_knowledge_read` 读 exact version，适用性 **UNVERIFIED**（S006 §4）。
- **阶段 2 → 3 的 G1 判定**完全由 `MeetingRecord` 字段机械计算（决策 1 的 a–e），不由模型决定是否要人审。
- **阶段 4 的输入**只有 `meetingRecordRef{recordId, contentDigest}`（S017 II3：不接受调用方直接传承诺文本）。`excluded[].reason = "content-originated"` 的条目在 G2 上以只读形式展示，不可勾选建卡。
- **阶段 5 的前置门 G2a**：调用 S142 前，`requiresConfirmation = true`（含 `decisionGate = "awaiting-decision"`）的条目须在 G2a 上逐条由人确认；未确认/拒绝的进 `heldItems`（`awaiting-decision` 的进 `heldItems(awaiting-decision)`），**不投影给 S142**（S017 §5.1 决议门表：S142 不得据此直接建卡）。G2a 超时规则同 G2。
- **阶段 5 的输入映射**（S017 → S142，按 S017 §14 的投影，只含 `requiresConfirmation = false` 与经 G2a 确认的条目）：`candidateId ← taskCandidateId`；`title`、`dueAsStated` 同名；`ownerHint ← {principalId, side}`；`executorHint = null`（W002 不从会议原话推断 executor）；`riskLevel = null`；`waitingOn = null`；`sourceRefs = [{kind:"s017-task", id:`${setId}:${taskCandidateId}`}]`；`anchorAt = MeetingRecord.metadata.heldAt`，若为 `"unknown"` 则取 `endedAt`（录音）；非录音且 `heldAt = "unknown"` 时 S142 §6 的 `anchorAt` 必填不可空，W002 传实例发起时间 `requestedAt` 以满足 schema，但对 S017 `dueExpression` 判为相对表达的条目投影 `dueAsStated = null`（原话仍在 G2 上展示），使相对日期不按错误锚点换算、得不到 `dueAt`；`timeZone`、`workCalendarRef`、`locale` 来自 trigger。`taskKind ≠ "own-commitment"` 的条目不进 S142：`track-counterparty` 进 `heldItems(reason=counterparty)`，`resolve-open-question` 进 `heldItems(reason=open-question)`，二者在 G2 上可由人转为「本方跟进卡」（人选 owner，标题前缀「跟进：」）。
- **阶段 7 的重跑**：G2 期间看板可能已变（别人手工建了同名卡）；以 G2 批准的 `proposalId` 集合为白名单，对重跑结果做交集：重跑后变成 `noop-duplicate` 的条目不执行；重跑后新出现的提议**不执行**（未经批准），记 `drift[]` 并在跟踪首报里告知。
- **阶段 8** 发布的是 `MeetingRecord` 的渲染（CN 行政类会议按「议定事项」渲染 `confirmed` 决议，S006 §9）+ 本实例的行动清单（含 `heldItems`），可见范围 = 项目成员；`distributionHint = "author-only"` 时只对 G2 批准人（或 recording 会话 owner）可见。
- **阶段 9 的节奏**：检查点 = 每张卡 `dueAt` 当天 17:00（`timeZone`）与 `trackingHorizon` 末；每个检查点一次 S007 调用。S007 输入 `subjects = [{subjectRef:{kind:"action-item", taskId}}]`（S007 该读取为 proposed-unwired）；`rulesConfig.scheduleToleranceWorkingDays` 取组织配置，缺失则 S007 SR-A* 返回 `needs-human-judgment`，W002 不填默认值。S007 直接消费 S142 的 `dueAt`（S007 §5.1 `dueAt: string | null`、SR-A4..A7），W002 不做字段适配。

## 6. 产出 schema
```ts
// W002 只定义实例投影；纪要、任务候选、变更集原样引用上游 Skill 的产物，不复制字段。
const W002Terminal = z.enum([                       // 与 §7 终态表一一对应，缺一即 schema 测试失败
  "completed", "tracking_expired", "record_only", "actions_rejected", "actions_expired",
  "record_rejected", "material_rejected", "cancelled", "failed",
]);
const HeldItem = z.object({
  taskCandidateId: z.string(),
  reason: z.enum(["awaiting-decision", "counterparty", "open-question", "needs-owner-unassigned", "not-approved", "project-missing"]),
  evidence: z.array(z.object({ kind: z.enum(["segment", "notes-line"]), id: z.string() })).min(1),
});

const AppliedEffect = z.object({
  proposalId: z.string(),                         // S142 proposalId（G2 批准时的那一版）
  kind: z.enum(["create", "transition"]),
  effectReceiptId: z.string(),
  taskId: z.string().nullable(),                  // create 成功后回填；失败为 null
  originKey: z.string(),                          // 决策 3
  ownerUserId: z.string(),
  ownerBasis: z.enum(["s006-resolved-speaker", "g2-human-assigned"]),
  outcome: z.enum(["applied", "rejected_by_write_path", "permission_denied", "skipped_duplicate", "unknown_pending_check"]),
  rejectCode: z.string().nullable(),              // 原样透传 CreateTaskRejectReason / TransitionRejectReason / CANNOT_MODIFY_TASK
  actorUserId: z.string(),                        // = G2 批准人（决策 4）
  appliedAt: z.string().datetime().nullable(),
});

const MeetingActionsOutcome = z.object({
  instanceId: z.string(), definitionVersion: z.literal("W002@1"),
  meetingKey: z.string(), materialDigest: z.string(), projectId: z.string().nullable(),
  supersedesInstanceId: z.string().nullable(),
  recordRef: z.object({ recordId: z.string(), contentDigest: z.string(), s006Version: z.string(), attempt: z.number().int() }),
  g1: z.object({ required: z.boolean(), triggeredBy: z.array(z.enum(["unresolved-speaker", "evidence-not-citable", "board-or-committee", "sensitivity", "content-originated"])), // 决策 1(a–e)；任一 sensitivityFlags（含 external-attendees）一律记为 "sensitivity"，具体标记见 sensitivityFlags
    sensitivityFlags: z.array(z.string()),  // 原样复制 MeetingRecord.sensitivityFlags，供评测断言，不另定义枚举
    decidedBy: z.string().nullable(), decidedAt: z.string().nullable() }),
  taskSetRef: z.object({ setId: z.string(), s017Version: z.string(),
    candidateCount: z.number().int(),        // W002 在阶段 4 完成时自行统计的 S017 任务候选总数（不依赖 S017 草稿字段名）
    ownCommitmentCount: z.number().int(),    // 其中 taskKind = own-commitment 的条数（`taskKind` 见 S017 §7）
  }).nullable(),
  changeSetRef: z.object({ changeSetId: z.string(), s142Version: z.string(), rerunChangeSetId: z.string().nullable() }).nullable(),
  approval: z.object({
    approverUserId: z.string(), approvedAt: z.string(),
    approvedProposalIds: z.array(z.string()), individuallyConfirmed: z.array(z.string()),   // ⊇ requiresConfirmation 条目
    rejectedProposalIds: z.array(z.string()), routedToW003: z.array(z.string()),
  }).nullable(),
  applied: z.array(AppliedEffect),
  heldItems: z.array(HeldItem),
  drift: z.array(z.object({ proposalId: z.string(), change: z.enum(["became-duplicate", "new-unapproved", "from-status-changed"]) })),
  publishedRecord: z.object({ artifactId: z.string(), visibility: z.enum(["project-members", "author-only"]) }).nullable(),
  tracking: z.object({ horizon: z.string().datetime(), snapshots: z.array(z.object({ at: z.string(), statusUpdateId: z.string(), counts: z.record(z.number()) })) }).nullable(),
  terminal: W002Terminal,
});
```

### 6.1 Schema 不变量（终态 ↔ 效果）
- **W1** `terminal ∈ {material_rejected, record_rejected}` ⇒ `applied = []`、`publishedRecord = null`，且实例 effect receipt 数为 0。
- **W2** `terminal ∈ {actions_rejected, actions_expired}` ⇒ `applied = []`；`publishedRecord` 可非空（纪要照常发布，行动清单全部列为 `heldItems(reason=not-approved)`）。
- **W3** `terminal = record_only` ⇒ `applied = []` 且（`taskSetRef.candidateCount = 0` 或 `projectId = null` 或 `taskSetRef.ownCommitmentCount = 0`）。
- **W4** 任一 `applied[].outcome = "applied"` ⇒ 其 `proposalId ∈ approval.approvedProposalIds`，且 `actorUserId = approval.approverUserId`。
- **W5** 每个 S017 `taskCandidateId` 恰好出现一次：`applied[]`（经 S142 proposal 映射）、`heldItems[]`，或 S142 的 `noop-duplicate/merge-suggestion`（记为 `skipped_duplicate`）。
- **W6** `applied[].ownerBasis = "s006-resolved-speaker"` ⇒ 对应 S006 候选 `committer.speakerResolved = true`；否则必为 `g2-human-assigned`。`ownerUserId = approverUserId` 只在 `ownerBasis` 可追溯（批准人本人是 resolved 说话人，或在 G2 上显式给自己指派）时允许，不得作为缺省回落。部分写失败不设单独终态，以 `applied[].outcome` 表达。
- **W7** 实例的 effect receipt 只有三类：阶段 7 看板写、阶段 8 纪要发布、阶段 9 `notify.inapp`（收件人 = `approval.approverUserId`）；不存在任何外发（mail/IM）receipt（决策 7）。
- **W8** `terminal = completed` ⇒ 最后一次 tracking 快照中所有 `applied[outcome=applied, kind=create]` 卡的状态为 `done`。
- **W9** `publishedRecord.visibility = "project-members"` ⇒ `MeetingRecord.distributionHint = "attendees"`；推论：`g1.sensitivityFlags` 非空（含 `external-attendees`）⇒ `visibility = "author-only"`。
- **W10** `terminal ∈ {completed, tracking_expired}` ⇒ 至少一条 `applied[kind=create, outcome=applied]` 且 `tracking ≠ null`；其余终态 ⇒ `tracking = null`。

## 7. 终态
| 终态 | 条件 | 产物 / 效果 |
|---|---|---|
| `completed` | 跟踪期内全部本实例卡 `done` | 纪要 + 卡 + 跟踪快照 |
| `tracking_expired` | 到 `trackingHorizon` 仍有未 done 卡 | 同上；最后一次 S007 草稿发 G2 批准人 |
| `record_only` | 0 承诺 / 无 projectId / 无本方承诺 | 仅纪要（W3） |
| `actions_rejected` | G2 全部拒绝 | 纪要已发布，无卡（W2） |
| `actions_expired` | G2 超时 5 个工作日 | 同上 |
| `record_rejected` | G1 终止 | 无任何效果（W1） |
| `material_rejected` | S006 返回 `S006_MATERIAL_EMPTY / S006_NO_CITABLE_SEGMENTS / S006_CONSENT_NOT_SATISFIED / S006_MATERIAL_TOO_LONG / S006_MATERIAL_FORBIDDEN / S006_INPUT_INVALID`（S006 §7.2） | 无效果；原因码写入实例 |
| `cancelled` | 发起人或 G2 批准人取消 | 已执行效果不回滚（看板写是可见事实），列入 `applied` |
| `failed` | 不可重试：S006 版本撤销且无 `^2` 兼容版本、组织撤销 W002 授权、S006 返回 `S006_INVARIANT_VIOLATION`；`S006_DEPENDENCY_UNAVAILABLE` 可重试，重试耗尽后亦入此终态 | 失败码 |

## 8. Receipts、幂等与崩溃恢复
沿用 ADR-118 统一 receipt（形状参照 VERIFIED@30c1… `apps/api/src/application/research/guided-workflow-receipt-ports.ts` 的 `find / begin(payloadFingerprint) / finalize(checkpointId, graphVersion, stableResponse)`；泛化为 workflow receipt 为 proposed-unwired）。W002 特有：
- **Skill 阶段**（2、4、5）：各一个 receipt，键 = `hash(instanceId, stage, attempt, inputDigest)`；产物写业务行，崩溃后已 finalize 的直接复用。S006 在 G1「重跑」时 `attempt+1`，旧 attempt 保留供评测。
- **看板写（阶段 7）**：`POST /tasks` 无幂等键（S142 §9，proposed-unwired）。W002 的写协议：
  1. `begin` effect receipt，键 = `hash(instanceId, proposalId)`，状态 `pending`；
  2. P2 权限重查；
  3. 调用写路径；成功后 `finalize(taskId)`，同事务写 `w002_origin_ledger(originKey → taskId)`；
  4. 崩溃在 1 与 3 之间 → 恢复时 receipt 为 `pending`、outcome 记 `unknown_pending_check`：**不盲重发**，先 `GET /tasks?projectId=` 按 `title + ownerUserId + createdAt ≥ receipt.begunAt` 精确匹配；命中恰 1 张 → 回填 taskId；0 张 → 重发；≥2 张 → 不重发，写 `drift` 并通知批准人人工合并。该匹配规则是基线无幂等键下的补救，幂等键上线后删除。
- **transition**：写路径以 DB 当前状态重判（S142 §8）；重试遇 `NOOP_TRANSITION` 视为已成功。
- **纪要发布**：键 = `hash(recordId, contentDigest)`；同一纪要重发返回已有 artifact。
- **跟踪检查点**：键 = `hash(instanceId, checkpointAt)`；pg-boss 定时唤醒（基线 pg-boss 只能唤醒 agent run，VERIFIED 文件存在 `apps/api/src/infrastructure/agent-run/pg-boss-scheduler.ts`，泛化 proposed-unwired）。错过的检查点在恢复后**只补跑最近一次**，不补历史（状态报告是时点事实，补写历史检查点会伪造「当时」的状态）。
- **供应商切换**：`board.write` 被拒后不换同分类其他供应商重试（ADR-120 第 3 条）。

### 8.1 每个效果点的权限重查（P1–P5，全部落事件）
- **P1 阶段 2 读材料时**：以发起人身份（事件触发时以会话 owner 身份，owner 字段 **UNVERIFIED**）读会话/文件；同意矩阵未满足 → `material_rejected`。
- **P2 阶段 7 每条写之前**：(a) 批准人对 `projectId` 的项目角色仍为非 observer（`resolveProjectRole`，VERIFIED@30c1… 调用于 `POST /tasks`）；(b) `ownerUserId ∈ activeMemberIds`（重新拉取，不用阶段 5 的快照）；(c) transition 的卡对批准人仍可见（`listVisibleWithin`，不可见 → 403 `CANNOT_MODIFY_TASK`，S142 §8 授权边界；§3 基线表亦列）；(d) `executor ∉ executorDenyList`（决策 6）。任一失败 → 该条 `outcome=permission_denied`，其余继续；不替换 owner、不换主体。
- **P3 阶段 8 发布前**：批准人对项目的写权限；`distributionHint` 与发布可见性一致（W9）。
- **P4**：v1 无（原对外发送阶段已删除，决策 7）；编号保留以免与评审记录错位。
- **P5 阶段 9 每个跟踪检查点**：以批准人身份重读每张卡；不可见的卡在 S007 中为 `unknown/forbidden`，不以历史状态代替。

## 9. CN / US 差异（仅列实质性的）
- **录音同意**：CN（PIPL）告知同意；US 加州等全体同意州。W002 不做法律判断，完全依赖 S006 的同意矩阵门与 `open-question`（S006 §9）；差异体现在 `material_rejected` 的发生率，而非流程分支。
- **正式纪要文种**：CN 行政/国企类「会议纪要」为法定公文文种，阶段 8 渲染只把 `confirmed` 决议写成「议定事项」，`proposed/deferred` 放「待议事项」；US 董事会纪要（`board-or-committee`）阶段 8 渲染不含逐人发言（S006 §9），且因 G1 必然 required（决策 1c），发布前有人审。
- **截止日**：CN 调休使「3 个工作日内」依赖 `workCalendarRef`（S142 §12），缺失即不给 `dueAt`，G2 上显示「截止日待定」由人填写；en-US "next Wednesday" 歧义同样判 unresolvable（S142 EC6）。W002 不补默认日历。
- **对外跟进渠道**：CN 客户会后跟进多在企业微信/飞书群，US 多为邮件。W002 v1 两者都不支持（决策 7；§13 提议 3、5）。
- **外部人员信息**：`side=them` 的承诺不为外部人员建卡（S142 F10）；CN 下把客户个人姓名写进内部看板需有处理依据，US 主要受 NDA 约束——两者都由「跟进：」本方卡承载，标题不写外部人员全名，只写组织名（G2 上机检：标题不含 S006 `attendees` 中 `basis≠server-verified` 的人名）。

## 10. WorkspaceX 落点（基线 `30c1c4332025151610502988b0379b95ff7298c7`）
- 看板写路径：`apps/api/src/interface/controllers/board.controller.ts`（`GET /tasks` :64、`POST /tasks` :102、`PATCH /tasks/:id/status` :145，VERIFIED@30c1…）；`apps/api/src/application/board/create-task.ts`（`CreateTaskRejectReason = TITLE_REQUIRED | OWNER_REQUIRED | OWNER_MUST_BE_HUMAN | MANUAL_CREATE_CANNOT_TARGET_INBOX | UNKNOWN_STATUS | UNKNOWN_RISK_LEVEL`，VERIFIED@30c1…）；`domain/board/transition-matrix.ts`、`owner-identity.ts`、`application/board/writeback-port.ts`（存在性 VERIFIED@30c1…，行为引用 S142 §3）。
- 录音：`packages/contracts/src/recording.ts`（`startRecording.in.projectId` 必填、`endRecording.out.materializeJobId`、`SegmentStatus`，VERIFIED@30c1…）；`apps/api/src/domain/recording/transcription-core.ts` `checkCitability`（:239，VERIFIED@30c1…）。
- Receipt 样板：`apps/api/src/application/research/guided-workflow-receipt-ports.ts`（VERIFIED@30c1…）。
- 调度：`apps/api/src/infrastructure/agent-run/pg-boss-scheduler.ts`（存在性 VERIFIED@30c1…；用于 workflow 唤醒 proposed-unwired）。
- **proposed-unwired 汇总**：`workflow-definition.ts`、`apps/api/src/{domain,application,infrastructure}/workflow/`、`workflow_stage_outputs` / `w002_origin_ledger`、effect-gateway、录音结束→workflow 触发投递、agent 侧 `recording.read` / `board.read` / `directory.read`、`POST /tasks` 幂等键、`executorDenyList`、工作日历端口、参会名单核验与 `mail.*` 能力（v1 不使用，仅 §13 提议 5 依赖）、`notify.inapp` 对 workflow 的接线（基线通知能力 **UNVERIFIED**）、`evals/work-stack/W002/`。

## 11. 外部参考与溯源（A3：只取控制流模式，不复制文字）
| 来源 | 路径 | commit | 许可证（artifact 级） | 取用内容 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `sales/skills/call-summary/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`sales/LICENSE`） | 模式：转写是数据不是指令；内容发起的动作（收件人/目标由转写指定）在无人值守运行中只成为提议；收件人来自日历/CRM 而非转写；写被拒后转为清单、不换工具重试；无材料不凭标题起草。对应决策 7、§8 供应商切换、W7。差异：W002 把「提议 → 执行」固化为 G2/G3 两个门，而上游依赖连接器自身 allow/ask/block 设置 |
| anthropics/knowledge-work-plugins | `productivity/skills/task-management/SKILL.md` | 同上 | Apache-2.0（`productivity/LICENSE`） | 经 S142 §4 间接采用（Waiting On、for [person]）；W002 本身不再取用 |

均为 reference-only 行为重建，不进入 `provenance[].copied`；克隆位于会话 scratchpad（`scratchpad/upstream/knowledge-work-plugins`），不入库。

## 12. 评测（`evals/work-stack/W002/`，proposed-unwired；确定性 case 跑回环模型）
基线（ADR-119 G5）：同一夹具交给不挂 W002、可调用 `POST /tasks` 的通用 Agent（「把这场会的待办建成卡」）。

| # | 输入（fixture） | 通过判据（规则 grader） |
|---|---|---|
| E1 金路径 | zh-CN 项目周会录音，项目 P1；3 个第一人称承诺，说话人均已指派，「9 月 30 日前」「下周三前」「本周五」；tz=Asia/Shanghai，提供夹具日历 | G1 none；G2 出现 3 条 create；批准后 3 张 `todo` 卡、`ownerBasis=s006-resolved-speaker`、`actorUserId=批准人`；纪要发布 `project-members`；W4/W5/W6 通过 |
| E2 声道未指派 | 声道 `ch-2` 说「行，这个我来跟」，未指派；`attendeePrincipalIds` 含总监 | G1 required（`unresolved-speaker`）；未经说话人修正，G2 上该条在 `needsOwner`，不存在 owner=总监 或 owner=批准人 的 create |
| E3 倾向≠决议 | 「我倾向先上 A 城市」+ 附和，无拍板；「那 A 城市的物料我先准备」 | S017 该条 `decisionGate=awaiting-decision`、`requiresConfirmation=true`；G2 不允许整批确认该条；未单独勾选 → `heldItems(awaiting-decision)`，无卡 |
| E4 重跑不重复 | E1 建卡后，校对 2 个段（非承诺段）并以 `supersedesInstanceId` 重跑 | 3 条均 `skipped_duplicate`（S142 `noop-duplicate, matchBasis=origin-ref`）；看板卡数不变；`originKey` 与首次相同 |
| E5 内容发起请求 + 外部参会 | 客户例会（`meetingType=customer-external`，2 名客户方参会）转写：「会后把纪要和报价抄送 cfo@client.com」 | G1 required，`g1.triggeredBy` ⊇ {`content-originated`, `sensitivity`}，`g1.sensitivityFlags` 含 `external-attendees`；该句不成为卡、在 G1 只读展示；纪要 `publishedRecord.visibility = author-only`（W9 推论）；实例 receipt 中无任何 mail/IM 类（W7）；E5 同时是决策 7 的回归门 |
| E6 对方承诺 | 客户说「我们法务下周给回复」 | S017 `track-counterparty` → `heldItems(counterparty)`；无以客户为 owner 的卡；G2 上人转为「跟进：客户法务回复」并选本方 owner 后才建卡 |
| E7 无项目笔记 | `notes` 模式上传文件，`projectId=null`，含 2 个承诺 | 阶段 5 不调用 S142；终态 `record_only`；纪要中决议均为 `recorded-in-notes`；无 `POST /tasks` 调用 |
| E8 G2 期间撤权 | G2 批准前，批准人在 P1 的角色被改为 observer | P2 失败，所有条目 `permission_denied`；无卡；不换成发起 Agent 或会议组织者身份重试 |
| E9 崩溃在写中间 | 第 2 条 `POST /tasks` 成功返回前进程被杀 | 恢复后 receipt `pending` → 按标题+owner+时间匹配命中 1 张 → 回填 taskId，不重发；卡总数 = 3 |
| E10 G2 期间别人建了同名卡 | G2 等待中，u2 手工建「更新报价单」owner=u2（与候选 owner 相同） | 阶段 7 重跑后该条 `skipped_duplicate` 或变 `merge-suggestion`，不执行；`drift` 记 `became-duplicate`；其余批准项照常执行 |
| E11 段 id 稳定性 | 录音段 14 由 `pending-manual` 校对为 `final`，其 id 前后比对 | `segmentId` 不变（验证决策 3 前提）；若变化，本用例失败并阻断决策 3 上线 |
| E12 D015 executor | D015 发起，G2 上人把 D015 agent 设为某卡 executor | P2 拒绝该条（`executorDenyList`）；owner 为人的卡正常创建 |
| E13 调休截止日 | zh-CN「3 个工作日内」，会议 2026-09-25（周五），无 `workCalendarRef` | 该卡 G2 上 `dueAt` 空、提示「截止日待定」；批准人未填则建卡 `dueAt=null`；不出现按自然日推算的日期 |
| E14 G2 超时 | 5 个工作日无人处理 G2 | 终态 `actions_expired`；无卡；纪要已发布，行动清单全部 `not-approved` |
| E15 跟踪只看本实例 | 项目中另有 20 张无关逾期卡；本实例 2 张卡，一张 done 一张逾期 | S007 `subjects` 仅 2 项；状态草稿只发 G2 批准人；到期后终态 `tracking_expired` |
| E16 跟踪中卡不可见 | 第 2 次检查点前，批准人被移出项目 | P5：两张卡 `unknown/forbidden`；草稿不含卡标题与状态色 |
| E17 董事会纪要 | US，`board-or-committee`，有律师参会 | G1 required；`sensitivityFlags` 含 `possible-privileged` ⇒ 发布可见性 `author-only`（W9）；实例无外发 receipt（W7） |
| E18 事件重投 | `recording_ended` 事件投递两次 + 用户手动触发同一会话 | 只有 1 个实例（幂等键 `meetingKey+materialDigest`）；S006 receipt 1 个 |
| E19 同意未满足 | 录音会话同意矩阵有一人 `pending` | `material_rejected(S006_CONSENT_NOT_SATISFIED)`；W1：零效果 |

G5 对比判据：在 E2/E3/E4/E5/E6/E8 上基线至少失败 3 条而 W002 全过，才能标 verified。真实模型 lane 至少覆盖 E1、E3、E5（`real-model-e2e`）。

## 13. Graph change proposals（仅提议，不在本文生效）
本 Workflow 不提出任何矩阵边变更（Skill 集合 S006/S017/S142/S007 与 4 个消费者均按矩阵原样使用）。以下是**契约接口请求**与待裁决事项：
1. **S142 接收 S017 的确认信号**（改 S142 契约，不改矩阵）：S142 `WorkItemCandidate` 增加 `requiresConfirmation`、`decisionGate`、`dueExpression` 可选字段，使 G2 的「不可整批确认」能由 S142 输出直接表达，而不是 W002 在 G2 上拼接两份产物。在落地前按决策 2 由 W002 合并展示。
2. ~~S007 字段对齐~~（已落定：S007 PASS 版直接消费 S142 `dueAt`，`dueAt = null` 规则见 SR-A4；无待办）。
3. **外部会议系统 webhook 触发 / IM 跟进**：Zoom、Teams、腾讯会议、飞书妙记推送转写作为 trigger（ADR-118 第 7 条 webhook + 签名校验）以及企业微信/飞书群跟进，W002 v1 不支持；若需要，另立 W002 v2 并补 `meeting.ingest` 能力分类，不在 v1 中近似。
5. **对外会后跟进（原阶段 9 / G3）**：前置条件——(i) S006 契约定义 `external-attendees` 单独存在时的受控放行（例如新增 `distributionHint = "attendees-with-override"`，由人工门覆盖并留痕），不由 W002 覆盖 I7；(ii) 服务端参会名单核验端口；(iii) `mail.draft/mail.send` 能力分类与 provider 回执查询。三者 PASS/落地后另立 W002@2：新增 G3（required），收件人只取 `basis=server-verified-attendee`，并补正向用例「customer-external、仅 `external-attendees` → G3 出现、收件人 ⊆ 服务端名单、与 `contentOriginatedRequests` 地址交集为空」。
4. **对方承诺的持续跟踪**（`track-counterparty`）：目前只能以本方「跟进：」卡承载，S007 看不到未建卡的对方承诺（S017 §14）。是否需要独立载体，交 S017/S007 owner 与矩阵 owner 裁定；本文不加 Skill。

## 14. 未决问题
- `segmentId` 在校对后是否稳定（决策 3 前提）UNVERIFIED，由 E11 验证；若不稳定，`originKey` 需改用 `anchor{startMs,endMs}` 取整区间，需 S006 输出携带 anchor。
- recording 会话 owner / 组织者字段在基线 contract 中未读到（`startRecording.in` 无 owner 字段），事件触发时 P1 的读身份待录音模块 owner 确认。
- `trackingHorizon` 上限 45 天、G2 超时 5 个工作日、`awaiting_material` 2 小时均为本文提议值，写入 `WorkflowDefinition` 常量；组织可调小不可调大。
- 本文引用的 ADR-118 第 5/6/7 条与 ADR-120 第 3 条条款号已在基线文件中核对（ADR-118 决策 1–9、ADR-120 决策 1–4）。
