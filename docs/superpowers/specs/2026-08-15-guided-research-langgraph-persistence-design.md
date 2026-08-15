# 引导式 Deep Research LangGraph 节点持久化设计

## 1. 背景与已确认决策

当前引导式 Deep Research 已具备研究首页、主题、研究方向、大纲、演示检索和演示报告界面。
主题、方向和大纲已有部分业务表持久化，但步骤推进仍由仓储中的 SQL 状态更新控制；检索任务、
来源决策、报告内容和部分 Skill 状态仍依赖前端 Mock 或 localStorage。

用户于 2026-08-15 确认以下目标：

1. 五个研究步骤分别成为 LangGraph 节点。
2. 每一步的数据都属于 LangGraph 的逻辑状态。
3. 前端调用任一步骤时，都必须提交当前前端节点的完整状态内容，而不是只提交步骤名或按钮动作。
4. 刷新、离开、API 重启和节点失败后，都能从同一研究会话恢复。
5. 页面保持单路由；步骤切换不得依赖路由跳转或整页刷新。

本设计采用 TypeScript LangGraph，运行在 `apps/api`，生产 checkpointer 使用 PostgreSQL。
现有 Python `apps/deep-agent-service` 可以继续提供模型或检索能力，但不拥有 BoardX 研究流程状态。

## 2. 目标与非目标

### 2.1 目标

- 用一个稳定 LangGraph thread 管理一项研究的完整生命周期。
- 用五个可恢复节点表达 Brief、Directions、Outline、Research 和 Report。
- 用统一 Node Command 契约接收前端当前节点的完整状态。
- 用 checkpoint、幂等 receipt 和业务内容表保证重放安全。
- 用服务端投影恢复页面，不再把 localStorage 当作正式事实源。
- 保留历史 checkpoint，使上游重确认、失败重试和问题审计可追踪。

### 2.2 非目标

- 不在一个 Feature/PR 中同时交付全部五步；按垂直切片串行合并。
- 不让浏览器直接访问 LangGraph checkpointer。
- 不把来源全文、抓取页面、完整报告二进制重复复制到每个 checkpoint。
- 不在本轮增加导出、分享、评论或洞察入库。
- 不将模型生成内容冒充真实来源；真实 Web Search 仍必须产生可追溯来源记录。

## 3. 总体架构

```mermaid
flowchart LR
    UI["单页 Research UI"] -->|"NodeCommand + 完整 nodeState"| API["Research Workflow API"]
    API --> AUTH["租户授权 + 版本校验"]
    AUTH --> GRAPH["Guided Research StateGraph"]
    GRAPH --> B["Brief"]
    B --> D["Directions"]
    D --> O["Outline"]
    O --> S["Research"]
    S --> R["Report"]
    GRAPH --> CP["PostgreSQL Checkpointer"]
    GRAPH --> EFFECTS["幂等业务 Effects"]
    EFFECTS --> DB["步骤内容 / 来源 / 报告业务表"]
    GRAPH --> PROJ["Workflow Projection"]
    PROJ --> UI
```

边界原则：

- LangGraph 是步骤、节点版本、恢复位置、失败和重试状态的权威控制平面。
- Graph State 拥有每一步的逻辑状态；大内容以稳定 ID 和版本进入 Graph State，由读投影补齐正文。
- 业务表是来源、报告正文等产品数据的可查询持久层，不自行决定下一步。
- Web 只理解 BoardX 契约，不解析 LangGraph 内部 checkpoint 或上游检索事件。

## 4. 稳定身份与版本

- `thread_id = sessionId`
- `checkpoint_ns = guided-research:v1`
- `graphVersion`：每次成功 Node Command 后递增，用于乐观并发。
- `requestId`：每次用户意图的稳定幂等键。
- `operationId = sessionId:node:action:graphVersion:requestId`
- `contentVersionId`：步骤大内容的不可变版本标识。

所有 `invoke`、`stream`、`getState`、`getStateHistory` 和 `Command({ resume })` 都必须携带同一个
`thread_id` 与 namespace。客户端传入的 `orgId`、`actorId` 或任意 checkpoint ID 均不可信。

## 5. Graph State

```ts
type ResearchNode = "brief" | "directions" | "outline" | "research" | "report";
type NodeStatus = "locked" | "editing" | "ready" | "running" | "failed" | "completed" | "stale";

interface GuidedResearchGraphState {
  sessionId: string;
  orgId: string;
  ownerUserId: string;
  currentNode: ResearchNode;
  graphVersion: number;
  revision: number;

  brief: BriefNodeState;
  directions: DirectionsNodeState;
  outline: OutlineNodeState;
  research: ResearchNodeState;
  report: ReportNodeState;
  skill: ResearchSkillState;

  lastOperationId: string | null;
  lastRequestId: string | null;
  lastCompletedNode: ResearchNode | null;
  failedNode: ResearchNode | null;
  failureCode: string | null;
  invalidatedFromNode: ResearchNode | null;
}

interface NodeMeta {
  status: NodeStatus;
  version: number;
  confirmedVersion: number | null;
  contentVersionId: string | null;
  confirmedAt: string | null;
  updatedAt: string;
  errorCode: string | null;
}
```

### 5.1 BriefNodeState

```ts
interface BriefNodeState extends NodeMeta {
  name: string;
  tags: string[];
  topic: string;
  goal: string;
  timeRange: string;
  region: string;
  focus: string;
}
```

创建弹窗确认名称和 Tags 后立即创建会话与 Brief checkpoint，主题、目标等字段可以暂时为空；
确认 Brief 时校验名称、主题和目标，成功后解锁 Directions。重确认 Brief 创建新 revision，并将
Directions、Outline、Research、Report 标记为 `stale`。

### 5.2 DirectionsNodeState

```ts
interface ResearchDirection {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  order: number;
}

interface DirectionsNodeState extends NodeMeta {
  basedOnBriefVersion: number;
  candidateVersion: number;
  directions: ResearchDirection[];
  generationStatus: "idle" | "running" | "failed" | "ready";
}
```

前端每次保存或确认都提交当前完整方向数组。确认时至少一项启用；重确认后 Outline、Research、
Report 进入 `stale`。

### 5.3 OutlineNodeState

```ts
interface OutlineSection {
  id: string;
  title: string;
  description: string;
  researchQuestions: string[];
  order: number;
}

interface OutlineNodeState extends NodeMeta {
  basedOnDirectionsVersion: number;
  candidateVersion: number;
  sections: OutlineSection[];
  generationStatus: "idle" | "running" | "failed" | "ready";
}
```

确认时章节非空、ID 唯一、顺序连续。重确认后 Research 和 Report 进入 `stale`。

### 5.4 ResearchNodeState

```ts
interface ResearchTaskState {
  id: string;
  sectionId: string;
  query: string;
  status: "queued" | "running" | "failed" | "completed";
  attempt: number;
  sourceIds: string[];
  errorCode: string | null;
}

interface ResearchNodeState extends NodeMeta {
  basedOnOutlineVersion: number;
  runId: string | null;
  startKey: string | null;
  progress: number;
  currentQuery: string | null;
  tasks: ResearchTaskState[];
  latestSourceIds: string[];
  acceptedSourceIds: string[];
  excludedSourceIds: string[];
  eventCursor: number;
}
```

来源正文和抓取快照存业务表或 Artifact；Graph State 保存来源 ID、任务归属、采纳状态和版本。
Workflow Projection 按权限补齐标题、URL、域名、类型、抓取时间和摘要。重试只重跑失败任务，
相同大纲版本与 `startKey` 不得启动第二个 run。

### 5.5 ReportNodeState

```ts
interface ReportSectionState {
  id: string;
  outlineSectionId: string;
  title: string;
  markdownContentId: string;
  citationIds: string[];
  status: "queued" | "generating" | "failed" | "completed";
}

interface ReportNodeState extends NodeMeta {
  basedOnResearchVersion: number;
  reportId: string | null;
  title: string;
  summaryContentId: string | null;
  sections: ReportSectionState[];
  citationIds: string[];
  qualityCheckStatus: "pending" | "passed" | "failed";
  generatedAt: string | null;
}
```

报告 Markdown 与未来导出文件不重复放入 checkpoint；Graph State 拥有章节结构、正文版本 ID、引用
集合与生成状态。投影返回用户可见的完整报告。引用只能解析到同一研究 revision 的已采纳来源。

### 5.6 ResearchSkillState

```ts
interface ResearchSkillState {
  threadId: string;
  activeNode: ResearchNode;
  summaryId: string | null;
  recentMessageIds: string[];
  activeProposalId: string | null;
  proposalStatus: "none" | "proposed" | "applied_to_draft" | "rejected" | "committed" | "stale";
}
```

Skill 消息发送后持久化。Skill 只生成针对当前节点的结构化 patch；应用 patch 会进入前端 nodeState，
只有再次提交 Node Command 才成为 Graph State 的新 checkpoint。

## 6. 前后端统一 Node Command

```ts
type ResearchNodeAction =
  | "save"
  | "generate"
  | "confirm"
  | "start"
  | "retry"
  | "complete";

interface ResearchNodeCommand<TNodeState> {
  sessionId: string;
  node: ResearchNode;
  action: ResearchNodeAction;
  requestId: string;
  expectedGraphVersion: number;
  nodeState: TNodeState;
}
```

每次调用必须包含当前节点完整 `nodeState`。服务端执行顺序固定为：

1. 由 Principal 获取 `orgId` 和 `actorId`，验证会话可见性。
2. 读取同一 `thread_id` 的最新 checkpoint。
3. 校验 `node === currentNode`，或属于允许回看的已完成节点。
4. 校验 `expectedGraphVersion`。
5. 按节点 schema 校验完整 `nodeState`，拒绝未知字段和非法下游 ID。
6. 计算 payload 指纹；同一 `requestId` 不同 payload 返回 409。
7. 用 `Command({ resume: command })` 恢复当前 interrupt。
8. 节点通过幂等 Effect 写业务内容与 receipt，再返回 Graph State update。
9. Checkpointer 保存新 checkpoint。
10. 返回重新水合的 Workflow Projection。

禁止客户端直接提交或覆盖：`orgId`、`ownerUserId`、`graphVersion`、`revision`、服务端时间、错误码、
来源正文、报告正文和任意其它组织的数据 ID。

## 7. API 契约

建议在 `packages/contracts/src/research.ts` 增加统一操作，保留旧操作作为迁移期兼容层：

| 操作 | HTTP | 作用 |
|---|---|---|
| `getGuidedResearchWorkflow` | `GET /research/guided-sessions/:sessionId/workflow` | 返回最新 Graph 投影和当前 interrupt |
| `executeGuidedResearchNode` | `POST /research/guided-sessions/:sessionId/workflow/nodes/:node` | 提交完整 nodeState 并执行 action |
| `listGuidedResearchEvents` | `GET /research/guided-sessions/:sessionId/workflow/events?after=` | 恢复检索/报告运行进度 |
| `appendGuidedResearchSkillMessage` | `POST /research/guided-sessions/:sessionId/skill/messages` | 持久化 Skill 消息并生成 proposal |

统一成功响应：

```ts
interface GuidedResearchWorkflowProjection {
  sessionId: string;
  graphVersion: number;
  revision: number;
  currentNode: ResearchNode;
  availableNodes: ResearchNode[];
  nodeSummaries: Record<ResearchNode, NodeMeta>;
  activeNodeState: HydratedNodeState;
  skill: HydratedResearchSkillState;
  interrupt: { node: ResearchNode; allowedActions: ResearchNodeAction[] } | null;
}
```

新增封闭错误码至少包括：

- `RESEARCH_WORKFLOW_UNAVAILABLE`
- `RESEARCH_NODE_LOCKED`
- `RESEARCH_NODE_MISMATCH`
- `RESEARCH_GRAPH_VERSION_CONFLICT`
- `RESEARCH_NODE_STATE_INVALID`
- `RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH`
- `RESEARCH_CONTENT_REFERENCE_INVALID`
- `RESEARCH_TASK_NOT_RETRYABLE`

无权与不存在继续使用同一不可区分响应，不泄露其它组织的 thread 或 checkpoint 是否存在。

## 8. Graph 节点与 interrupt

```mermaid
stateDiagram-v2
    [*] --> Brief
    Brief --> Directions: confirm
    Directions --> Outline: confirm
    Outline --> Research: confirm + start
    Research --> Research: progress / retry
    Research --> Report: complete
    Report --> Report: retry generation
    Report --> [*]: complete

    Directions --> Brief: revisit
    Outline --> Directions: revisit
    Research --> Outline: revisit
    Report --> Research: revisit
```

每个人工节点以 `interrupt()` 暴露当前节点投影和允许动作。恢复时使用相同 thread 的
`Command({ resume: ResearchNodeCommand })`。因为恢复会从包含 interrupt 的节点开头重新运行，
所有 Effect 必须放在 interrupt 之后，并通过 receipt 幂等。

运行型节点 Research 和 Report 使用子图或 task 拆分长任务。每个章节检索、报告章节生成分别拥有
稳定 operation ID；失败恢复不得重放已完成章节。

## 9. 双层持久化

### 9.1 Checkpointer

- 使用 `@langchain/langgraph-checkpoint-postgres`。
- 独立 schema：`langgraph_research`。
- schema 初始化由 migration/setup 完成，应用启动不动态建表。
- 运行账号只获得所需 DML 权限。
- checkpoint 访问前必须先通过业务会话完成租户授权。

### 9.2 业务内容表

在现有 `guided_research_sessions` 和版本表基础上演进，建议增加：

- `guided_research_node_receipts`
- `guided_research_revisions`
- `guided_research_runs`
- `guided_research_tasks`
- `guided_research_sources`
- `guided_research_source_decisions`
- `guided_research_reports`
- `guided_research_report_sections`
- `guided_research_citations`
- `guided_research_skill_threads`
- `guided_research_skill_messages`
- `guided_research_skill_proposals`
- `guided_research_timeline_events`

所有租户表以 `org_id` 参与复合约束并启用 RLS。跨表引用必须在数据库层保证同组织、同会话和同
revision，不依赖应用层约定。

### 9.3 一致性与重放

业务事务与 LangGraph checkpoint 不假定原子双写。节点先执行幂等业务 Effect：

1. 事务内锁定会话或 revision。
2. 校验 graphVersion、revision 和 operationId。
3. 写业务数据与 `guided_research_node_receipts`。
4. 返回稳定业务 ID。
5. 节点把 ID 写入 Graph State，由 checkpointer 保存。

若进程在步骤 4 和 5 之间退出，节点重放命中 receipt 并返回首次结果，不重复搜索、调用模型或写报告。

## 10. 单页前端状态

- 首页：`/research`。
- 会话：`/research?session=<sessionId>`。
- `flow=` 不再是步骤状态来源；旧分享链接只在首次进入时解析，然后用 `history.replaceState` 收敛到
  canonical URL，服务端 `currentNode` 优先。
- 五步导航、编辑器和 Skill 助手都在同一 React 页面树内。
- 步骤切换更新本地选中节点和服务端投影，不使用 `router.push` 切步骤，不重新挂载整页。
- 左侧 Skill 助手占桌面工作区约三分之一；右侧进度和当前节点工作区约三分之二。
- 当前节点有未提交修改时，切换、返回首页或关闭页面必须提醒。
- 恢复时只信任 `getGuidedResearchWorkflow`；localStorage 仅可用于非权威 UI 偏好，不能恢复业务状态。

## 11. 上游重确认与下游失效

| 重确认节点 | 新 revision | 保留 | 标记 stale |
|---|---:|---|---|
| Brief | 是 | 旧 checkpoint/history | Directions、Outline、Research、Report |
| Directions | 是 | 当前 Brief | Outline、Research、Report |
| Outline | 是 | Brief、Directions | Research、Report |
| Research 来源决策 | 否 | 检索结果 | Report |
| Report | 否 | 全部已采纳来源 | 旧报告生成版本 |

失效采用版本和状态标记，不硬删除历史内容。当前读投影只水合当前 revision，旧 revision 仅用于审计和
受控恢复，不得混入新报告。

## 12. 迁移与兼容

1. 新会话在创建名称和 Tags 后立即创建 `guided-research:v1` Brief checkpoint；不等到 Brief 确认。
2. 为现有会话创建 `guided-research:v1` 初始 checkpoint。
3. 从现有 brief、directions、outline、stage、status 和 progress 生成初始 Graph State。
4. 旧演示搜索/报告不升级为真实证据；迁移后保持未运行或演示标记。
5. 迁移期旧 confirm/start/complete API 转换为统一 Node Command，Web 完成切换后再删除旧写入口。
6. Backfill 幂等；重复执行不得生成多个 thread 初始 revision。
7. 无法安全映射的会话进入 `failed` 并返回可诊断错误，不静默重置为 Brief。

## 13. 安全与可观测性

- Graph State 不保存跨组织敏感正文或密钥。
- 模型、检索、Artifact 读取前后都复核权限；撤权后不得落业务数据。
- 日志记录 `sessionId`、node、revision、graphVersion、operationId、checkpointId、耗时和错误码，
  不记录主题正文、来源正文、报告正文或 Skill 消息。
- 指标至少覆盖节点成功率、interrupt 等待时间、恢复次数、幂等命中、checkpoint 大小、章节重试和
  stale revision 数量。

## 14. 失败与恢复语义

- 409 版本冲突：返回最新投影，前端提示用户重新应用本地修改。
- 节点校验失败：不写业务表、不推进 checkpoint。
- 模型或搜索失败：当前节点进入 `failed`，已完成任务和来源继续可见。
- Checkpointer 不可用：历史业务读模型仍可查看；写操作返回依赖不可用，不伪装成功。
- 业务内容可用但 checkpoint 缺失：进入修复路径，不从卡片文案猜测当前节点。
- SSE/事件断线：客户端携带 cursor 重连，先补发缺失事件再进入实时流。

## 15. 串行 Feature 切片

现有 F170、F171 保留其用户可见目标；Graph 基础和前三步迁移不能偷并进一个超大 PR。规格确认后，
由 requirement-author 在权威 `feature_list.json` 中登记缺失切片并经束级签核，建议顺序：

1. **Graph 基础 + Brief 垂直切片**：PostgresSaver、统一 Command、Brief 前后端持久化、单页恢复。
2. **Directions 垂直切片**：完整方向 nodeState、生成/编辑/确认、回退失效。
3. **Outline 垂直切片**：完整大纲 nodeState、生成/编辑/确认、回退失效。
4. **F170 Research 垂直切片**：真实检索任务、来源、进度、事件恢复和失败章节重试。
5. **F171 Report 垂直切片**：结构化报告、引用、水合、失败重试和完成态。

五个切片共享 `packages/contracts/src/research.ts`、Research Graph State、Web 单页工作区和 migration，
必须串行；每一项单独 issue、分支、验证和 PR。

## 16. 验证策略

### 16.1 契约

- 五种 Node Command 都要求完整 nodeState。
- 未知字段、非法引用、缺少 requestId、缺少 expectedGraphVersion 均失败。
- 成功和错误响应封闭，Web 与 API 使用同一 schema。

### 16.2 真实 PostgreSQL / LangGraph

- 每个节点确认后产生 checkpoint，API 重启后从相同 thread 恢复。
- 同 requestId 同 payload 返回首次结果；不同 payload 返回 409。
- checkpoint 前后进程退出不会重复写业务内容或重复启动外部调用。
- 上游重确认只使规定的下游节点 stale。
- 跨组织 session、业务记录和 checkpoint 均不可见。

### 16.3 Web

- 步骤切换不改变 canonical URL、不触发整页刷新。
- 每次写调用都包含当前节点完整状态。
- 刷新后恢复服务端当前节点和已确认内容。
- 未来节点禁用；已完成节点可查看，重确认时显示下游失效提示。
- Skill 应用只改页面草稿，再提交 Node Command 才进入 checkpoint。

### 16.4 Research / Report

- 单章节失败不清空其它任务和来源。
- 重试不重复执行已完成章节。
- 来源采纳/排除刷新后保持。
- 报告 citationId 只解析到当前 revision 的已采纳来源。
- 报告失败仍能查看真实搜索结果并重试。

## 17. 风险与控制

1. **Checkpoint 膨胀**：大正文外置，State 保存版本 ID；监控序列化大小。
2. **Graph schema 演进**：节点名和既有字段保持兼容；新增字段提供默认值；迁移旧 checkpoint。
3. **双写不一致**：Effect receipt + operationId 幂等，禁止在 interrupt 前产生副作用。
4. **并发覆盖**：graphVersion 与 payload fingerprint 双重校验。
5. **旧路由回退**：保留旧 URL 解析测试，但只由服务端 currentNode 决定实际步骤。
6. **范围失控**：五个垂直切片串行，一项一 PR；不在基础切片中实现真实 Web Search 或报告。

## 18. 完成判据

当五个切片全部合入后：

- 一项研究对应一个持久 LangGraph thread。
- 五个步骤都有明确 Graph Node 和可检查 checkpoint。
- 每次前端节点调用均提交完整 nodeState。
- 前端刷新、API 重启、任务失败和离开返回均能恢复。
- 步骤切换不再依赖 `flow=` 路由或整页刷新。
- Search 与 Report 不再读取 Mock/localStorage 作为业务事实。
- 所有报告引用均可追溯到同 revision 的真实已采纳来源。

## 19. 开工门禁与仓库治理

本设计获产品确认后，运行时代码开工前仍必须完成以下仓库动作：

1. 在 UC-24.6 增加可解析的 LangGraph 节点持久化需求锚点，记录“完整 nodeState + 单路由 +
   checkpoint 恢复”这一新决策，不用 F170 的旧 R4 暗示它已经覆盖全部 Graph 基础。
2. 为 Graph 基础、Brief、Directions、Outline 三个缺失垂直切片生成新的 feature 四元组；F170 和
   F171 继续只承担真实 Search 与真实 Report。
3. 更新 `contracts/research` 的 UI、用例、API 契约与 coverage，把新 feature 纳入 `covers`；
   `design-signoff.md` 的确认状态只能由人类修改。
4. 重新执行阶段一致性复核，重点核对 Agent Runtime、Skill、Files/Artifact 和 Research 的跨束约束。
5. 收口当前 F180 “代码和 issue 已合入/关闭，但 feature_list 仍为 in_progress”的状态漂移；在此之前
   不 claim F170，不并行修改共享 Research 热点。
6. F170 已建立公开 issue #1357；后续每个新增 feature 仍需各自 issue、分支、验证和 PR。
