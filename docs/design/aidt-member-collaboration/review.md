# AIDT 小组共享成果与成员文字沟通 最小设计审阅包

**状态：待人类签核的提案，尚未实现。** 本文的路径、字段、限额和存储设计都是实施建议，不是已经批准的 API，也不是课程讨论的原话。没有新增 `packages/contracts`、controller、migration 或运行时传输。签核此方案不等于生产部署授权。

## 请求确认的范围

建议确认两项独立能力，可分别批准：

1. **小组共享阶段草稿**：每个 AIDT 项目、每一步一份共享工作稿；成员可读取、修改和重新打开，保存有服务器版本、作者和时间；冲突时保护双方内容。
2. **项目成员纯文字频道**：每个项目先提供一个主频道，并允许围绕一条主消息开启单层话题线程；同组成员持久发送和增量读取。发送不调用模型、不创建 AgentRun、不收费生成。首版没有语音、私信、组织公共频道、消息附件、编辑或删除功能。

两者复用原有 WorkspaceX API 进程、PostgreSQL、会话与 Project 两层鉴权，不另建通话或消息服务器。不改变普通 Chat 发送语义，不把普通 Project 改成 AIDT，不替学生决定阶段完成。

## 为什么现有服务不能直接代用

查证基线：`95bb37d728104a4d8888993724e985236e0f38ee`（本次冲刺初始提交；下列实现核对于 2026-11-15 北京时间）。

| 现有能力 | 已核实行为 | 不能冒充的能力 |
| --- | --- | --- |
| `chat.operations.createMessage`，`chat.ts:816`；`chat.controller.ts:427`；`message-roundtrip.ts:143` | 必填 `agentId`；原子接受 human message 与 queued AgentRun；controller 随后 kick 执行器 | 纯人类频道；不得发后再取消模型、塞假 Agent 或清空 roster 绕过 |
| `thread-message-queue.ts` 契约及 `infrastructure/chat-queue/thread-message-queue.ts:35` | 缺省 `agentId` 时解析默认 Agent，派发仍调用 `acceptHumanMessage` | 不能利用 nullable Agent 字段静默存人类消息 |
| Whiteboard 评论，`whiteboard-collaboration.ts:30`、`whiteboard.controller.ts:98` | 绑定 board、对象、评论线程，使用 Board 独立访问边界 | 不是项目全局频道；Project 成员不自动获得 Board 权限 |
| Design 评论，`design-comments.ts:1`、`design-workbench.controller.ts:483` | pm-design/node/frame 批注，已签核为组织内协作范围 | 不能借其组织可读写规则实现小组隔离聊天 |
| 工作坊广播，`live-collab-stage-aggregation.ts:70` | 面向工作坊的主持/组长广播，`visibleToAllGroups=true` | 不适合 general 项目，不是组内双向消息流 |
| Artifact `saveDraft`，`artifact.ts:255` | 输入没有可写阶段内容字段；自动保存不产生固定快照 | 不能把任意表单 JSON 当作已接通的共享保存 |
| Chat `landAsArtifact` 与 `land-as-artifact.ts:190` | 有真实消息来源和草稿文件；draft 的读取限创建者；没有共享稿的 expectedRevision CAS | 可以做个人服务器检查点，不能称小组共享成果；不得伪造 agendaSegmentId 去 pin |
| `TeamTextConversation` UI | 由父层提供消息与 callbacks；类型明确是 Preview，当前无传输 | 不能把本页消息或 BroadcastChannel 称跨设备发送成功 |

## A 小组共享阶段草稿 提议契约

以下均为**待签核操作**，最终类型签核后才放进 `packages/contracts`；本提案不修改既有 Chat/Artifact 契约。

| 操作 | 提议请求 | 提议成功响应 |
| --- | --- | --- |
| `GET /projects/:projectId/aidt/stages` | 项目路径；会话身份 | 六阶段摘要：`stageId`、`revision`、`updatedAt`、`updatedBy`；不存在的阶段标为尚未保存，不生成示例 |
| `GET /projects/:projectId/aidt/stages/:stageId` | `stageId=1..6` | 当前共享稿或 `null`；含 `projectId,stageId,revision,content,sourceStageRevisions,updatedBy,updatedAt` |
| `PUT /projects/:projectId/aidt/stages/:stageId` | `operationId: UUID`、`expectedRevision: integer>=0`、`content`、`sourceStageRevisions` | 服务器保存回执：上述完整稿件及 `replayed:boolean` |
| `GET /projects/:projectId/aidt/stages/:stageId/revisions` | `beforeRevision?`、`limit?`，默认20、上限100（设计值） | 不可变历史版本、`nextBeforeRevision`；每版包含服务器作者/时间及来源 |

`content` 使用版本化结构（`schemaVersion=1`），以已有阶段字段、点子及拟选结果为映射基础；不得存储 DOM、可执行 HTML、blob URL 或未上传 base64 图片。文本字段沿用现有每字段 6000 字符上限；总请求建议不超过 256KiB（均为设计细化）。图片、原型与证据仅保存已授权且确属本项目的资源/Artifact版本引用，实际工具成功回执另行核对。

来源必须区分原始材料引用、学生解释、AI草稿/待验证内容。`sourceStageRevisions` 保存显式继承的前序版本；前序改动只提示需核对，不自动覆盖或宣布后续成果失效。没有来源可以保存缺口，不补造证据。

### 保存不变量

- `expectedRevision=0` 只用于尚未创建的阶段；每次成功写入严格递增 revision，旧版不覆盖。
- 在一个事务内完成权限/归档状态核对、CAS、不可变版本和当前指针写入、幂等回执。两名成员并发只有一个基于同一旧版本的写入成功。
- 同一 `(orgId,projectId,actorId,operationId)` 与相同规范化请求重试，返回同一回执；相同 ID、不同内容明确冲突。幂等记录与保存事务一起提交，不能产生“保存成功却无回执身份”的分叉。
- 版本、作者、时间由服务器生成；调用者不能提交他人作者或伪造保存时间。保存共享稿不等于全组共识、教师验收或阶段完成。
- 客户端收到冲突后保留自己未发送内容并展示服务器版本，由学生比较后重试；不自动 last-write-wins，不以刷新丢弃本地稿。

## B 项目成员文字频道 提议契约

交互参考 Rocket.Chat 官方 [Rooms](https://docs.rocket.chat/docs/rooms) 与 [Threads](https://docs.rocket.chat/threads)：频道是项目沟通容器，话题在侧边聚焦，不打断当前教学页面。这是交互参考，不引入 Rocket.Chat 服务器、账号系统或权限模型。

独立能力域；先一个项目一个主频道，消息可作为单层话题根。页面跳转只切 UI 上下文，不重建频道。成员消息不经过 `createMessage` / `agent_runs`。

| 操作 | 提议请求 | 提议成功响应 |
| --- | --- | --- |
| `GET /projects/:projectId/member-chat/messages` | `beforeSequence?` 或 `afterSequence?` 二选一；`limit?` 默认30、上限100（设计值） | `items`、向前/向后游标、`latestSequence`；没有消息返回真实空列表 |
| `POST /projects/:projectId/member-chat/messages` | `clientMessageId:UUID`、`text`（1–4000字符）、`threadRootId?`（回复时）、`stageReference?`（主动选择，含阶段及可选共享稿revision） | `message`、`replayed`；200/201代表服务端持久接受，不代表别人已读 |
| `GET /projects/:projectId/member-chat/messages/:threadRootId/replies` | 同项目真实根消息、`beforeSequence?`或`afterSequence?`、分页限额同上 | 根消息引用、该话题回复、增量游标 |

`message`：服务器 `id,projectId,sequence,authorId,text,threadRootId,stageReference,createdAt`。`threadRootId=null` 是主频道消息；回复必须指向同组织同项目的真实主消息，不接受跨组根引用或无限嵌套。主列表展示服务器话题摘要（回复数与最新活动序号）；增量响应在同一消息游标内携带被修改的话题摘要，避免仅更新旧根而漏掉回复活动。作者显示名从既有授权身份服务派生，不接收客户端伪造昵称/作者。阶段引用可选；它不是正式成果或真实研究证据，AI不自动入频道，也不自动读取频道内容。

幂等范围为 `(orgId,projectId,actorId,clientMessageId)`；请求内容相同重试不重复发，内容不同返回冲突。客户端未获得成功回执时保留原文及同一请求 ID，显示“发送中／未确认／失败”，不显示已发送；网络超时先用同 ID 重试，不能另造 ID 导致重复。

消息以项目内服务器递增 `sequence` 排序。推荐在已有 PG 中，对频道序号行持事务锁，分配序号、插入消息与幂等回执同事务提交；这样增量游标不会越过未提交的更早消息。组织/项目复合约束、tenant RLS 与应用鉴权同时存在，不以客户端过滤代替隔离。

**@成员、未读数和read cursor：后续范围，当前不实现也不显示假红点。** 要加入时需确认成员提及有效性、服务器通知回执、每用户每频道/话题已读水位、退出小组后的通知撤销，以及跨设备更新语义；消息送达和阅读是不同事实。首版可展示“查看话题”，不能称某人已收到通知或已读。

### 低成本接收方式

首版建议可见面板每5秒一次增量 HTTP 拉取，后台/隐藏面板暂停；重开、恢复网络和窗口获焦时立即补拉。约30名学生最多约6次增量读/秒只是预算估计，须实际负载验证，不能称容量已验收。延迟是秒级，不标为实时 WebRTC。

后续可在同一API进程加 SSE 作为唤醒，仍按序号补拉、仍服务器持久保存。浏览器直连需要鉴权信令、连接建立和断线历史策略，目前没有可复用服务；此次不伪造 WebRTC 已连接，也不新建通话服务器。是否另行做 DataChannel 直传作为可选优化，需独立确认，不阻塞先把文字消息正确保存和隔离。

## 权限、失败与数据关系

复用现有 `application/identity/authorize.ts` 与 `project-layer.ts` 的组织＋项目交集规则，不另造“老师自动全权”规则。读取需要当前项目可读资格，写入需要既有项目写资格；归档、组织停用时只读；成员被移除后立即失去后续读取/发送能力。每个读、写、重试、增量读取均重新鉴权。管理员也不能绕过项目成员边界。

AIDT阶段接口只服务服务器判定的 AIDT 项目；不添加新的 ProjectKind，不改普通项目字段及生命周期。成员文字频道作为整体功能可用于已授权普通项目，其开关及启用策略需单独确认，不能通过启用 AIDT 擅自改变全部项目。

概念数据：Project 1—6 StageHead；StageHead 1—N StageRevision；Project 1—1 MemberChannel；MemberChannel 1—N HumanMessage；根HumanMessage 1—N 单层回复；两类写入分别关联各自 OperationReceipt。新数据均属于当前 org/project；不修改 `chat_messages`、`agent_runs`、原有Artifact内容或正常项目行结构。

| 情形 | 提议语义 | UI处理 |
| --- | --- | --- |
| 未登录 | 401 | 登录；不显示旧组缓存 |
| 不存在/无项目读权/跨组枚举 | 同一不泄露内容的404出口，具体内部鉴权原因入安全审计 | 清除当前组可见数据，不冒空态 |
| 可读但不能写、项目归档、组织停用 | 403及可区分的只读原因 | 展示可读历史，禁用发送/保存 |
| 阶段CAS版本变化 | 409，确认读权后附当前revision/稿件 | 保护本地稿，人工比较重试 |
| 相同operation/clientMessage ID携带不同内容 | 409幂等冲突 | 原文保留，不自动换ID |
| 字段/来源引用无效、超限 | 422；过大请求413 | 明确指出问题；不称保存成功 |
| 鉴权依赖/存储依赖故障 | 503，不伪造列表或回执 | 原文保留，允许同ID重试 |
| 请求取消/超时但提交状态未知 | 客户端“未确认”；服务器不返回猜测成功 | 同ID安全重试，按回执去重 |

错误枚举的最终名称也待签核；不能把此表直接写成运行时常量后声称契约已存在。

## 兼容性与验收门槛

- 模块/新能力默认关闭。关闭不发新请求、不加载新数据；不删除既有用户内容。是否停用已经保存的成员频道需显式策略，不用开关代替权限撤销。
- 只新增独立命名空间及表，不更改普通Chat、Project、Artifact已有请求/响应；已有资源与版本引用继续由原服务验证。
- 重用当前认证、tenant DB端口与项目鉴权；不新增服务部署、生产操作或权限豁免。
- 最小真实验收：同组两账号在不同浏览器发送/读取与刷新恢复；A/B组互不可读写；归档后只读；成员移除后重试拒绝；两个客户端同时编辑同版只有一个CAS成功且双方文本保留；丢响应重试仅一条消息/一版成果；增量分页不丢消息；数据库重启后恢复；发送纯文字不创建任何AgentRun或模型费用。
- 阶段资料缺失、AI推测、新版待测试状态在保存、重开及报告中不变；个人服务器检查点与小组共享稿必须不同标签，不自动迁成组共享。

## 人类确认栏

- [ ] 同意 A：共享工作稿与版本历史、expectedRevision CAS、operationId 幂等，复用现有项目权限。
- [ ] 同意 B：独立纯人类主频道、单层话题线程及持久保存；先采用上述增量 HTTP 方案（约5秒），语音与直传优化后置。
- [ ] 确认不扩大现有成员权限，不复用AI消息发送冒充人类频道，不将保存/发送回执当共识或已读。
- [ ] 如只同意其中一项，请明确批准项及需要修改的字段/语义。

签核人、时间、所选范围：**待人类填写。AI没有签核。** 上线前另需确定真实访谈/聊天资料的保留期限、删除/导出办法和课程授权；本包不替代这些决定。
