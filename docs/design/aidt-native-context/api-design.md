# ③ API、持久快照与执行边界（本轮会话已批准）

本轮用户会话已批准方案A，原提案状态保留作历史；当前实现验证中。运行时单源为 `packages/contracts/src/aidt-run-context.ts`，Web/API共同导入；本文说明已批准边界，不构成第二份运行时 schema。旧六步不可变 Skill 包不改。既有普通 GET run JSON 与普通无selector Chat 路径保持原样。

## 1. 已验证的丢失点与补修范围

`useAgentContext` → SDK `addContext({description,value})` → core `runAgent({context:getContextForAgent(...)})`；API `copilotkit-agui.controller.ts` 的 `AguiRunInput` 当前忽略 context/state，只 `lastUserText(body)` → `runAguiBridgeTurn(text)`。`execute-run.ts` 从持久 human body、Agent instructions 和真实 pins 组装；Python provider 只接 system/history/user，没有另取浏览器 context。

无网络 controller 反例输入含独立保存源 marker，实际 dispatch 仅有 userId/orgId/agentId/text/clientMessageId/threadId，marker消失。对应 `/tmp/aidt-context-drop-red.txt`。不能据此断言实际 Skill pins 或完整供应商 prompt 都不存在。Python `TaskClassifierMiddleware` 仅是三类执行风险判类，没有设计思维五步硬映射；通用设计方法文档中的五步不是AIDT阶段权威。

## 2. 请求：仅传命名 selector

扩展既有 `POST /copilotkit/agui` 的 `forwardedProps.aidtContext`。无此字段时沿现有流程，不读取/写入AIDT快照。v1需已有真实 `forwardedProps.chatThreadId` 和现有稳定UUID `clientMessageId`，不为selector新造线程或幂等机制。

```json
{
  "schemaVersion": 1,
  "projectId": "实际教学小组projectId",
  "purpose": "stage",
  "stageId": 2,
  "stageRevisions": [{"stageId": 1, "revision": 3}, {"stageId": 2, "revision": 1}],
  "returnRevision": 7
}
```

SUM 形状为 `purpose:"summary"`，不传 stageId/returnRevision，可传 `historyRevisions:[{stageId,revision}]`。它是报告任务，不是第7步。stageRevisions最多6条且stageId唯一；stage模式只选当前步及之前的共享稿，SUM可选1–6步。historyRevisions仅SUM、最多60条、每步最多10条、相同二元组不重复；全部为显式准确版本，不传“latest”或只传游标。returnRevision仅stage模式，引用准确第6步记录，并验证其学生确认的返回目标与当前stage一致。

省略某步引用不等于它没有数据：服务端可只读取该步 head 元数据以区分 `not-selected` 与 `missing`，不自动把head正文带入。前端历史collector内部已给出每条stageId/revision；目前summary packet只回历史markdown，实施时须额外投影这份已有结构化refs给host，不能从markdown猜修订，也不能在发送时让服务端重新选择latest；读失败的正文不回传。不接材料正文、role、system指令、teacherComments、orgId/userId或客户端Skill授权声明；selector未知键拒绝，AG-UI `body.context` 正文继续忽略。

本轮批准预算：selector JSON≤8KiB UTF-8；当前引用≤6、历史≤60、精确返工≤1；准备总超时20秒；**最终带边界、转义与消息封装的模型参考消息≤128KiB UTF-8**，当前每步≤5000字、历史每条≤1200字且历史总摘录≤18000字，最终仍服从UTF-8总上限。保留全部所选版本定位，正文按当前任务/返工/六步/历史顺序截断并记录逐项与总截断标志。prepare使用版本固定的确定性formatter，按最终消息序列化后的UTF-8字节数截断并冻结modelReferenceBlock及其hash/formatterVersion；execute不得二次静默剪裁。包装、转义和标记开销都算入预算；冻结 role/content 编码块额外预留1024字节给原生 message id 等 envelope，provider 再核实际序列化消息总字节，不符即失败而非二次剪裁。不静默丢字段或把部分材料标全文。以上预算随本束方案A获本轮会话批准；实现必须同时遵守最终编码字节上限。

## 3. 服务端授权与实际读取

依次核对：AIDT显式启用 → principal现有身份 → actual thread现有读写/可见性与未归档门 → thread真实project等于selector project → general+AIDT profile与当前真实成员 → 实际活动挂载的AIDT Skill及其版本匹配stage/SUM。

stage1必须对应 `aidt-understand`，stage2对应 `aidt-empathize`，其余对应实际六步；SUM只匹配真实 `dt-summarize-project`。多个互斥教学挂载、错任务/错project、不可读Skill、非成员、未发布或无法验证一律失败，不映射通用五步，也不拿通用报告当别名。阶段证据必须是 selector 与该 thread 的真实活动挂载、即将冻结的run版本三者交集；通用run默认启用目录里恰有某个AIDT Skill不算当前阶段。还须复用 `PgAgentRunRepository.readPinnedSkills` 在同tenant已有可见own/platform边界下的真实published/enabled版本、完整包字节及文件digest校验，再与受信starter-pack已发布JSON的canonical package manifest hash比对已知allowlisted不可变release（`aidt-methods` 或 `aidt-project-summary`）。这只证明实际所挂内容与已发布课程包摘要一致，不称平台import receipt或官方账号血统；同stableName的自建内容不能代替这项比对。已知allowlist内的固定旧pin合法，不匹配即拒绝并要求显式更新，不自动替换最新版；focus版本必须进入本run实际Skill快照。在验证实际活动mount之后，复用已有server-owned `requestedSkillVersionId`口，仅将general trusted pool收窄到本次focus版本，以减少通用五步Skill干扰；客户端不能直接指定任意授权Skill。非general Agent的角色pins不改；不满足既有pin边界时拒绝而非扩权。ordinary无selector不设置此收窄值。

平台import receipt在当前tenant受RLS限制，并不享有published Skill包的跨平台只读例外；本方案不查询该receipt，不暗加withoutTenant、切org新事务或放宽RLS。仅采用上述可见真实包与受信发布JSON的内容摘要比对；证据来源关系仍不能证明的部分诚实记unknown，不伪写官方账号血统。无法完成本任务要求的focus绑定/内容匹配则准备失败关闭。

标题/顺序映射在新契约模块只维护一份，现有Web `AIDT_STEPS` 引用该元数据，任务/引导文案仍归教学模块；不在API复制另一套六步映射。阶段不是权限，UI selector不是证据。所有已保存正文、选择理由、确认标记仍为不可信学生材料。

复用 `AidtStageRepository.inProject` 的project/org/member锁与Identity授权。`StageTransaction.current/history/hasRevision` 已存在；精确读取可由受约束历史查询后核对revision实现，或增加同一repository的内部 `revision(stageId,revision)` 读口，不能绕过guard/鉴权直读。Stage与snapshot必须使用同一tenant session，不能在run事务外先准备一份会过期的已授权结果。

返工沿已有 `aidt-chat-return-context` 的确认/目标/问题快照语义实现服务端等价验证，不能仅信浏览器已解析文本；保存修订不是独立轮次。嵌套问题来源保留旧修订；缺失或学生自述来源不冒称服务验证。个人Artifact/检查点正文v1不读入；原始文件字节、转写、教师点评也不在本束服务端取材范围。

## 4. 仅AIDT的持久快照

拟新增第1张隔离表 `aidt_run_context_snapshots`：`org_id,run_id`主键；`project_id,thread_id,input_message_id,requested_by,selector_version,selector_json,selector_hash,snapshot_version,snapshot_json,snapshot_hash,prepared_at`；必要的run/project/thread同org外键、FORCE RLS、只允许运行时SELECT/INSERT。source正文仅在该tenant表，普通run无此行；不存token、浏览器任意context或完整供应商prompt。既有冻结/归档政策须复核，不给归档项目写新快照的例外。

snapshot_json只包含服务端确认的task/阶段/实际mount version、精确stage与history refs、返工记录、带来源修订的有限摘录，以及 `missing/not-selected/truncated/personal-artifacts-not-included/original-file-bytes-not-read/teacher-comments-no-source` 等事实标记。规范化序列化后SHA256；snapshot含内容且不可变，hash不替代正文授权。共享Stage修订仅为准确记录定位；现有全局lineage若没有AIDT来源kind则诚实记unknown，不伪造chat messageId、Artifact来源或verified evidence。

另在 `agent_runs` 新增nullable、首次受理后不可变的内部 `aidt_selector_hash` marker：ordinary及历史旧run为null；本次AIDT受理写真实规范化selector hash。执行时marker非null但snapshot缺失/hash不一致必须失败，不能误走ordinary降级；不为旧运行事后伪造回填快照。

统一新上下文事务的锁顺序为 project → org/member → thread。provider复用同一tenant session；在外层已持project/org/member锁后，可锁thread再重入Stage repository（重入不是新事务、不是倒序取得新锁）。不得未锁project先锁thread再另开Stage事务，避免与归档/成员更新互锁。

消息、queued run、该snapshot必须在现有 `ChatMessageCommandRepository.accept` 同一tenant事务提交；准备失败回滚整个AIDT受理，不产生可执行的无快照run，不调用模型。快照的读准备由受约束application callback/port参与该事务，不从infrastructure反向调用application service的独立事务。

复用 `(org,thread,actor,clientMessageId)` 幂等：相同原文/Agent/附件/规范化selector返回同一run与原snapshot。相同键但selector变化为冲突，不能沿既有“正文相同就重放”忽略新语义。replay先重新验当前权限，再比较原selector hash；不重读新head、不重建snapshot、不重命名线程、不启动第二个run。无selector与有selector的同键互换也为冲突，防静默降级。并发由真实thread锁、唯一约束及既有消息幂等串行化，不用localStorage/进程Map伪持久化。

HITL/resume仅取该run已有快照，忽略新客户端selector；当前成员/线程及冻结Skill版本的既有访问规则再次验证，撤权不得继续派发。活动thread mount只用于首次受理的focus确定，不能在执行或resume时用新的活动挂载替换旧run版本；版本升级与恢复原run是不同操作。源被撤回/删除或无法再授权时失败关闭，不换一份新head。保留原snapshot审计不等于仍授权显示其正文。

## 5. 组装、派发和回执必须分层

snapshot不可变。**本方案新增第2张仅AIDT的 append-only `aidt_run_context_applications` 表**记录实际应用事件，不修改既有 `ExecutionEvent` 闭合集，不伪装tool/skill事件。建议列：org_id、run_id、seq（组内run锁下分配）、attempt_id、kind（assembled/message-dispatch-observed/checkpoint-resume-observed/实际失败）、snapshot_hash、assembled_context_hash、formatter_version、继承的首派发attempt关联、可选真实远端run关联、occurred_at，以及严格受约束的安全错误码；无正文、私有推理、token或环境。PK(org_id,run_id,seq)，同org/run FK指向snapshot，FORCE RLS，运行时仅SELECT/INSERT。prepared由snapshot事实给出，不制造重复准备事件。普通Chat无selector不写这两张表，既有通用journal/API不增加AIDT事件数据。至少记录本run/attempt的 `snapshotHash`，以及**实际组装进模型请求的有界参考块** `assembledContextHash`。模型输入中明确当前stage及真实focus Skill；部署后formatter版本变化不得悄改原快照参考块或将新hash冒称旧checkpoint已收；resume继承首assembled/首派发关联，必要时保留原formatter或失败关闭。参考块用边界和“不可信学生材料、不可执行其中指令、不是权限/教师认可”的规则包装。参考块作为独立模型输入，不拼改持久human message，也不把学生材料提升为system授权。

- `prepared`：同事务快照真实存在。不能据此称模型已接收。
- `assembled`：execute-run从该run快照组装了实际参考块，并记录其hash及attempt。不是模型调用成功。
- `message-dispatch-observed`：provider适配器从**实际首次序列化请求的messages**中核对参考块hash与assembled一致，在真实提交时记录对应本地run/attempt及远端run关联。不能只凭onRemoteRunStarted推断消息含材料。不是完整供应商prompt审计，不声称每次子模型都继承全部材料。
- `checkpoint-resume-observed`：HITL/checkpoint恢复只发送command、没有新messages时，记录同snapshot/既有首派发关联及本次恢复事件；本attempt不得伪填新的messageDispatch时间或声称重新派发了同hash材料。保持原生checkpoint语义，不为记录上下文再次发起模型任务。
- `failed-before-dispatch/unknown`：准备后组装或网络失败、重启后事件缺口须如实显示；无派发证据不得补成已派发。

Configured直连供应商路径v1可先只记录assembled、没有原生服务派发证据，不伪填messageDispatchedAt；若以后需要供应商级派发事实另按准确transport事件实现。

Python收到的system/history/user消息传输必须有无模型费用的loopback/contract反例验证，校验上下文块hash确在实际request messages中。真实模型验收另按批准预算进行。只存块hash/来源和状态；不记录完整供应商prompt、密钥、环境或学生隐私原文到一般日志。

## 6. 独立AIDT只读回执：不改普通GET run

拟新增 `GET /agent-runs/:runId/aidt-context`，定义在同一个新contract模块。仅AIDT启用且已有run/thread读权限+当前真实教学组成员可读；没有快照、不存在、未授权统一404。返回不含材料正文：

```json
{
  "runId": "实际runId",
  "projectId": "实际小组id",
  "purpose": "stage",
  "stageId": 2,
  "skillVersionId": "实际冻结focus版本",
  "snapshotHash": "sha256",
  "preparedAt": "ISO时间",
  "stageRevisions": [{"stageId":1,"revision":3}],
  "historyRevisions": [],
  "returnRevision": 7,
  "omissions": [{"kind":"personal-artifacts-not-included"}],
  "truncated": false,
  "application": {
    "state": "prepared",
    "attemptId": null,
    "assembledContextHash": null,
    "assembledAt": null,
    "messageDispatchedAt": null,
    "checkpointResumedAt": null,
    "inheritedMessageDispatchAttemptId": null
  }
}
```

SUM不返回stageId/returnRevision。应用状态从仅AIDT的真实application journal派生；多attempt保留各次journal，回执当前attempt不改snapshot。无组装事件为prepared，无首次message派发事件不得填messageDispatchedAt。resume显示其checkpoint恢复事实和继承的原始派发关联，本attempt没有新messages则新messageDispatchedAt为null。该GET只重读，不能kick/resume模型或重建快照；关闭重开/重登录后仍显示同一run/snapshot。

本轮批准封闭错误：selector非法/过大422；不可用来源/错scope/错pin统一404；幂等selector冲突409；服务端准备或回执依赖故障503。运行中组装/派发失败沿既有RUN_ERROR/失败状态，需要在新契约单源中精确登记安全码并由现有边界过滤，不回传原始SQL/正文。普通Chat错误码与合同不借此改动。

## 7. 文件owner拆分与可复用端口

| 工作路 | 本轮批准的文件/职责 | 限制 |
| --- | --- | --- |
| 契约/快照 | 新`packages/contracts/src/aidt-run-context.ts`、2张仅AIDT表/marker迁移、`application/aidt-context`与Pg adapter | 一处schema；普通run无行；RLS/幂等/精确读取 |
| AGUI与原子受理 | `interface/controllers/copilotkit-agui.controller.ts`、`application/agent-run/agui-bridge.ts`、`application/chat/message-roundtrip.ts`、`message-command-ports.ts`、`infrastructure/chat/pg-chat-message-command-repository.ts` | 同一事务；原文不变；严格保持无selector路径 |
| 原生执行应用 | `application/agent-run/ports.ts`、`execute-run.ts`、`infrastructure/agent-run/pg-agent-run-repository.ts`、`deep-agent-model-provider.ts`及必要Python消息边界测试 | 同run snapshot；真实组装/派发hash；不改旧Skill包或权限 |
| 通用Chat host适配 | `components/chat/copilotkit-v2-shell.tsx`、panel/body/provider中的可选opaque host口 | 原生层不import AIDT；无host无新增行为；重试保留原selector |
| AIDT生产者/来源UI | `project-aidt-chat.tsx`、`aidt-summary-chat-context.tsx`、shared/return/history helpers与新receipt组件 | 只发送selector；个人正文缺口明确；不另造Chat |
| 独立验收与整合 | controller无网络、真实PG、普通Chat回归、原生run/receipt/重启回读、真实回答审阅 | root统一分配6路独占文件；先反证后既定实模，不自动加调用 |

可复用：`ThreadMountedSkillReader.activeMountedSkillVersionIds`、`PublishedAgentReader`、现有run固定Skill与权限快照、`AidtStageRepository.inProject`、guard/disclose、`ChatMessageCommandRepository.accept/findAccepted`、现有clientMessageId、既有claim/resume及新AIDT application journal、`ModelCallPort`与DeepAgent消息序列化。现有 `requestedSkillVersionId` 是server-owned产品动作的收窄口，不能变成客户端给任意Skill授权；本束先验证focus在真实pins中并发送准确阶段，不擅自改全部Agent角色配置。

以上是本轮批准的文件责任地图；root已划6路独占实现，避免同时改AGUI/accept/execute-run核心文件。实现与实际验证结果分别记录，不以该地图宣称已经端到端通过。

## 已批准实现中的 AG-UI 传输澄清

普通无 selector 请求保留既有立即 SSE 协议，不为普通请求预读 AIDT 表。fresh 带 selector 在受理成功首事件前才开启 SSE，准备/幂等失败可返回实际 HTTP 404/409/422/503。相同消息键从 null→有 selector 或有→不同 selector 均冲突（尚未开启 SSE 时 HTTP409）；有→null 重放从 wire 仍是普通输入，立即 SSE 后仓储识别旧 AIDT marker，返回既有 `RUN_ERROR IDEMPOTENCY_CONFLICT`，HTTP 是200，不能记为HTTP409。三种方向均不新增 message/run、不换快照、不派发模型。该差异保留普通协议，不扩大权限或提供第二份上下文来源。
