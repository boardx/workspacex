# Deep Agent × CopilotKit 十分体验 Backlog

> 创建于 2026-08-22，coord-architecture；同日 v2——按人类 15 条改进意见修订
> （统一 4 级标尺 / D4 时间旅行 / D7 死循环+预算熔断 / D8 量化阈值 / D9 双向注入 /
> D10 可观测性 / TC-1~5 黄金场景 / 反伪造一票否决 / 物理证据闭环 / 应用层
> 「一切皆文件」五条 DA-12~16）。目标：agent+chat 体验达到行业顶级 10 分。
> 判据：`.harness/rubrics/deepagent-capability-rubric.md`（引擎能力，本 backlog 主判据）
> ＋ `chat-ux-acceptance-criteria.md`（端到端行为）＋ `chat-main-fidelity-rubric.md`（视觉）。
> 三份都要满，本 backlog 逐条标注它推动哪份的哪个维度。
>
> 纪律（继承 harness-slim-backlog 的教训）：
> - 每条一个 issue 一个 PR；估算标「估」，实测后立刻改写。
> - **每条完成后由独立会话按 rubric 重评**，评分史 append 到 rubric 文件。
> - 不造第二份事实副本：判据只在 rubric 文件里，这里只引用维度编号。

## 基线取证（2026-08-22，SHA 314a6561，全部实测）

```
deep-agent-service   deepagents 0.7.6 (uv.lock) / pyproject 地板 >=0.0.5   ← 差 15 个 minor
graph.py             create_deep_agent(model, tools, system_prompt)        ← 零 middleware
                     0.7 起 TodoListMiddleware 默认不带 → 连规划工具都没开
checkpointer         无（langgraph dev 平台内存态）→ 重启即失
agui-bridge.ts       轮询到终态后一次性打包成 SSE ← 协议流式、体验非流式
生产 /chat           纯轮询（chat-live-message-panel.tsx 自陈）
next.config.mjs      缺 /copilotkit rewrite → e2e 网关下 404（scope-clarification §4 点名）
CopilotKit 前端      react-core/react-ui 1.66.4 已装；runtime 未装（#654 排除 GraphQL 拓扑）
平行 loop            guided_research_graph.py 289 行手写 StateGraph（不走 deepagents）
引擎基线分           1.5 / 10（rubric 评分史首行）
```

## 你（人类）需要签署的清单

| # | 文件 | 决定什么 | 阻塞哪些条目 |
|---|---|---|---|
| S1 | ~~PROP-CHAT-COPILOTKIT-LANGGRAPH-001~~ | ✅ **已签（2026-08-22，选 B 双轨灰度，PR #1753 合并即签署）** | — |
| S2 | ~~rubric 签名行~~ | ✅ **已签（2026-08-22，人类 GitHub 网页端提交，`ceded207` 血统可查）** | — |
| S3 | 各条目 PR 合并（正常 review 流程） | — | — |
| S4 |（建议）修 F204 签核归属重复 | 解开 pre-push doctor 常红 | 不阻塞本 backlog，但每个 PR 都在被迫 --no-verify |
| S5 | 存量 VM 的 `/opt/workspacex` deploy.env 加一行 `KERNEL_DEEP_AGENT_STREAM_ENABLED=1` | 生产 agent 会话逐 token 流式生效（关掉即回纯轮询，S1=B 可回切） | DA-05 验收 |
| S6 | 存量 VM deploy.env 填 `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY=<key>`（LangSmith 账号的 key，人工密钥） | trace 上报生效，正式评分的 trace ID 物理证据从 LangSmith 项目里取 | D10④、正式评分 |
| S7 | 活体验证：VM 部署一轮后由独立会话跑 TC-1~TC-5 并归档物理证据 | 解封 D2/D3/D4 的中期分顶；产出第一个**正式**评分行 | 正式评分 |

## Backlog（依赖顺序排列）

### DA-00 评分机制落地 + 基线复核
- **推动**：全部维度的可测性
- **动作**：本文件 + rubric 合入；由独立会话按 rubric 复核基线 1.5 分（不信我的自评）。
- **状态**：pr_open（本 PR）

### DA-01 修 /copilotkit rewrite 缺口（已知、已点名、最小）
- **推动**：D2/D3 的可验证性（e2e 网关下端点可达）
- **动作**：next.config.mjs 加 `/copilotkit` 前缀 rewrite；补 e2e 断言。
- **规模**：估 <30 行。**无签署依赖，可立即做。**

### DA-02 引擎现代化：middleware 全开 + Postgres checkpointer
- **推动**：D1（规划）、D4（持久上下文）、D8（上下文工程）、D10（架构健康）
- **动作**：
  1. `create_deep_agent` 加 `TodoListMiddleware`、`SummarizationMiddleware`（0.7 的 by-name override 口径）、Filesystem/Subagent 中间件按需
  2. checkpointer：langgraph dev 平台态 → `PostgresSaver`（依赖已在 uv.lock）；注意 guided_research 注释里写的平台限制，需要分环境（dev 平台托管 / 自托管显式传）
  3. `pyproject.toml` 地板提到 `deepagents>=0.7,<0.8`，加 CI 门：地板与 uv.lock major.minor 一致才绿
- **验收**：向端点发多步任务，事件流里出现 `write_todos` 工具调用与 todos 状态更新；重启服务后线程可续。
- **无签署依赖**（deep-agent-service 是 #654 已授权范围）。

### DA-03 真流式桥：deepagents 原生 AG-UI 端点替换 agui-bridge 的假流式
- **推动**：D3（0.3→目标 1.0）、D2、D9
- **动作**：deep-agent-service 起官方 AG-UI 端点（`add_langgraph_fastapi_endpoint` 或 langgraph 平台等价物 + CopilotKitMiddleware），逐事件流出 TEXT_MESSAGE_CONTENT / TOOL_CALL_* / STATE_DELTA；`agui-bridge.ts` 改为纯代理或退役（保留 AgentRun 记账钩子——每个 tool_call 步仍走 `record()`，#742 的账本约束不变）。
- **验收**：curl 事件流，用时间戳证明逐步；`agent_run_steps` 账本无缺步。
- **依赖**：DA-02。**无签署依赖**（还没碰生产 /chat）。

### DA-04 修「每次开新线程」约束：AG-UI 桥支持既有 threadId 续聊
- **推动**：D4、chat-ux 维度 6
- **动作**：桥/端点接受 threadId 复用 checkpointer 线程；无则新建。
- **依赖**：DA-02（有真 checkpointer 才有真线程）。

### DA-05 前端切换 —— **改判（2026-08-22 实测）：架构已被 #654 阶段2d 完成，剩余是一个部署开关**
- **状态**：done（改判 + 开关落模板）
- **实测发现**（开工前核对，与 DA-01 同一课）：原描述基于过时基线。生产面板
  `chat-live-message-panel.tsx` **已经**是「轮询权威 + SSE 叠加」双轨——对每个
  activeRunId 无条件 `openAgentRunStream`（GET /agent-runs/:runId/stream），
  delta 进 `streamingText` 逐 token 渲染，流路失败静默回退轮询。这正是 S1=B
  要的形状，且比原计划更优：不引入 `@copilotkit/runtime` 的 GraphQL 拓扑
  （#654 已明确排除它，preview panel 文件头有实测记录）。
- **完整链路**（DA-03 合入后已全通）：
  `deep-agent /runs/stream SSE → appendModelDelta → GET /agent-runs/:runId/stream → streamingText`
- **唯一剩余动作**：部署开关 `KERNEL_DEEP_AGENT_STREAM_ENABLED=1`（apps/api 读，
  deploy.env 注入）。新环境模板已加（provision.sh）；**存量 VM 的 deploy.env 需要
  人工加这一行**——记入下方签署/部署清单 S5。
- **验收**（部署开关打开后）：真实浏览器 agent 会话逐 token 出现；chat-ux 维度 1 重评。

### DA-06 工具调用卡片 + 规划条（generative UI）
- **推动**：chat-ux 维度 2/3/9（P7 是 P 组到 9/10 的唯一阻塞项）、D1/D2 用户可见化
- **动作**：`useDefaultTool` 渲染工具卡（名称/参数摘要/状态/结果）；todos 状态流渲染成规划条。
  样式服从 chat-main-fidelity-rubric（不引入风格孤岛）。
- **依赖**：DA-05。

### DA-07 人在环：interrupt_on 敏感技能审批
- **推动**：D6（0→1）、chat-ux 维度 9
- **动作**：`call_skill` 按技能风险配置 interrupt_on；前端渲染批准/拒绝/改参三态。
- **依赖**：DA-05。

### DA-08 错误透明与恢复
- **推动**：D7、chat-ux 维度 7
- **动作**：RUN_ERROR / tool 失败逐条渲染；agent 侧失败重试策略（deepagents retry 口径）；
  前端失败态持久可见 + 可重试。
- **依赖**：DA-05。

### DA-09 harness engineering：PreCompletionChecklist + 死循环/预算熔断 + 黄金压测场景
- **推动**：D7（v2 扩充后的三件套）、chat-ux 维度 4
- **动作**：
  1. `PreCompletionChecklistMiddleware`（退出前对照任务自检，LangChain 同模型 +13.7 分核心件）
  2. **LoopDetection 等价**：同一工具/文件重复操作超阈值注入纠偏
  3. **预算熔断**：最大步数/Token/时间至少两种强制生效，超限安全降级并明确通告（不是静默截断）
  4. **TC-1~TC-5 黄金压测场景脚本**落在 `apps/deep-agent-service/tests/golden/`，
     CI 跑自动化子集——rubric v2 规定每次正式评分必须跑完五场景，这条是评分客观化的地基
- **依赖**：DA-02。

### DA-10 guided_research 平行 loop 的裁决
- **推动**：D10
- **动作**：289 行手写 StateGraph 要么迁移到 deepagents（若 interrupt 语义可覆盖），
  要么在文件头写明豁免理由 + 签核。不允许无声地维持两套。
- **依赖**：DA-02 后评估，产出裁决材料给人类。

### DA-11 子代理委托可见化
- **推动**：D5（0→1）
- **动作**：SubagentMiddleware 启用 + 前端渲染「委托给 X」嵌套卡片。
- **依赖**：DA-06。

### DA-12 应用层虚拟文件系统（VFS）⚠ 需 S1
- **推动**：D8（卸载落点）、D9、「一切皆文件」路线的地基
- **动作**：用户上传附件、网页片段、agent 产出物、任务清单统一抽象为带唯一 URI 的虚拟
  文件对象，跨会话持久化 + 文件树管理。**先盘点复用**：本仓已有 files 模块 / chat-file-upload /
  canvas 产物链（F41 七源 materialize），VFS 是给它们一层统一寻址，不是第二套存储——
  发现重叠以既有实现为准（同一事实不两处声明）。
- **依赖**：DA-02（引擎侧 FilesystemMiddleware 的落点）；与 DA-05 并行。

### DA-13 双栏联动：Chat + 活动文件工作台 ⚠ 需 S1
- **推动**：chat-ux 维度 8/9/10、「一切皆文件」的交互主体
- **动作**：左栏流式对话与决策过程；右栏活动文件工作台（Active File Panel）——长文档/代码
  不再塞进聊天气泡，agent 打开/写入文件时右栏实时展开。样式服从 fidelity rubric。
- **依赖**：DA-12 + DA-15（文件事件流）。

### DA-14 显式/隐式文件上下文注入 ⚠ 需 S1
- **推动**：D9 到 1.0（上行注入是 v2 的硬指标）
- **动作**：
  1. 显式：输入框 `@` 引用工作区文件 + Pin 关键文档；文件胶囊（chips）展示所耗 token 预算
  2. 隐式：前端捕获右栏当前视窗/选中片段，请求时作为「临时文件切片」静默注入
     （useCopilotReadable 通路），并可在请求体中验证注入生效
- **依赖**：DA-12、DA-13。

### DA-15 文件事件流契约（AG-UI 命名空间扩展）
- **推动**：D2/D9、DA-13 的传输层
- **动作**：定义 `file_created` / `file_content_delta` / `file_patch_applied` 事件，
  作为 AG-UI **自定义事件命名空间扩展**——⚠ 边界：不 fork AG-UI 协议本身，标准事件
  （TEXT_MESSAGE_*/TOOL_CALL_*/STATE_*）语义不改，扩展事件走协议预留的 custom 通道；
  契约文件按 ADR-023 落 `packages/contracts/`，前后端共用单源。
- **依赖**：DA-03。

### DA-16 局部文件补丁 + 可视化 Diff ⚠ 需 S1
- **推动**：chat-ux 维度 8、D2
- **动作**：agent 改已有文件禁止全量重写——引擎侧走 FilesystemMiddleware 的 `edit_file`
  （patch 语义），事件流发 `file_patch_applied`；前端红绿 diff 高亮 + Accept/Reject。
  Reject 语义 = 不应用该 patch 并把拒绝原因回注给 agent。
- **依赖**：DA-13、DA-15。

## UX-9 冲刺（2026-08-23 人类裁决：以 UI 主卡到 9 分为目标，subagent 并行，全程无人类参与）

评分循环：改代码 → shots 真栈取证（慢速档）→ 独立评分员看图 → 实锤 → 下一轮。
两轮评分（各 1/10 证据分）已把「取证不足」与「真实缺陷」分干净，本冲刺按线并行：

| 线 | 范围 | 打哪几项 | 状态 |
|---|---|---|---|
| **A**（coord-architecture） | 流式交接无缝（草稿活到持久消息落位）· run 过程区独立于瞬态气泡（终态留存 3/3）· 折叠头不早下结论 + 逐工具参数摘要 · 三场景取证（展开态/markdown/真实失败） | 1 / 2 / 3 / 7 / 8 | v8 自证：streaming行=true×6、规划条留存到终态 |
| **B**（dev-chat-e2e 并行） | 一致性五处：右栏双态并存 ·「真实」等开发者词汇外泄 · 录音红色语义冲突 · agent 名称中途改写 ·（遮挡留 A） | 10 / 5 | 进行中 |
| **C**（dev-chat-e2e 并行，stack 在 A 上） | loopback 多步剧本（第二工具参数引用第一工具结果）+ 展开态取证——「看结果→定下一步」的链条可判 | 4 / 3 | 进行中 |
| **D**（A/B/C 合并后） | 上行上下文注入（useCopilotReadable 等价：视窗/选中→run 上下文）· DA-12 VFS · DA-13 双栏工作台 | 9 + 架构下半场 | 排队 |
| 活体半边 | 真实模型的 4/6 质量判定、真实麦克风的 5——devapp 取证（live-evidence workflow #1823） | 4 / 5 / 6 | 需部署环境 |

并行纪律：文件级禁区互斥（A 持 panel/tool-chain，B 禁入；C stack 在 A 分支）；
机器容量上限 3 条并行（parallel-dispatch 教训：四条线 load 50）。

## 研究结论落档（2026-08-23，R1 文档研究 + R2 上游仓库研究，全文见 issue 评论）

**R1（Generative UI 文档 ↔ 本仓对照）**：本仓 static 类型（真实数据→预定义组件）已到文档
描述的最好水平；到 9 分的杠杆不在加静态组件，而在 **Chat+ 面（双栏共创工作台，DA-13）**
与**上下文同步原语（上行注入，DA-14）**。open-ended HTML 本仓刻意排除是对的（安全/品牌
代价，文档同判）。唯一「文档点名、backlog 未立项」的缺口：通用 declarative UI schema
（Open-JSON-UI/A2UI 类）——**需人类裁决**是否引入（与「不做假 UI」判据有张力），不自行扩。

**R2（ag-ui 协议 + open-ag-ui-canvas 参考实现）**：
- 本仓桥覆盖 12/约 30 种事件；**状态轴（STATE_SNAPSHOT/DELTA）、推理轴（REASONING_*）、
  CUSTOM 通道整个为零**；生产 /chat 的三帧协议与 AG-UI 完全平行。
- canvas 参考实现的双栏联动建立在 shared state（后端 emit → 前端 useCoAgent 订阅 →
  上行回写）；**架构裁决：DA-13 两轴并用**——小而频的 UI 状态（当前文件/todos 进度）走
  STATE_DELTA（标准 JSON Patch，省契约），文件级 delta 走 CUSTOM（可扩展），不全自建。
- 不移植：CopilotRuntime GraphQL 拓扑（#654 已排除）、demo 级组件代码。

### 新增条目

**DA-17 状态与自定义事件轴（Line D2 进行中）**：桥加 STATE_SNAPSHOT/STATE_DELTA/CUSTOM
三型 + 首个真实生产者（write_todos → snapshot.todos）；反空转纪律：无真实数据不发事件。
DA-13/15 的传输前提。

**DA-18（需人类裁决后再动）**：通用 declarative UI schema。R1 点名的方法论缺口，
但与本仓「不做无真实后端支撑的假 UI」判据有张力——材料备好，等裁决，不自行扩。

### Line D 分派（同文件热点已由 R1 核清）

| 线 | 范围 | 热点 |
|---|---|---|
| D1 | chat-right-panel mock → 真实数据（DA-13 清障） | 无冲突，先行 |
| D2 | DA-17 事件轴（api 侧） | 无冲突（不碰 web） |
| D3（D1/D2 与 A 合并后） | 双栏 Active File Panel + 前端 STATE 消费 + 上行注入 | chat-live-message-panel 热点，串行 |

## 评分预期（诚实版）

| 条目完成后 | 引擎分预期 | 说明 |
|---|---|---|
| 基线 | 1.5 | 实测 |
| DA-02 | ~4（估） | D1+D4+D8+D10 各升 |
| DA-03/04 | ~5.5（估） | D3 到 1，D9 到 0.5 |
| DA-05/06 | ~7（估） | D2/D9 到 1 |
| DA-07/08/09/11 | ~8.5+（估） | D5/D6/D7 补齐（D7 v2 加了死循环+熔断，更难满） |
| DA-12~16 | ~9.5+（估） | D8/D9 的 1.0 硬指标（上行注入、卸载落点）靠这批 |
| **10 分** | 独立评分跑完 TC-1~5 + 物理证据闭环 + 人类确认 | **不承诺日期承诺机制**：每条做完必重评，最低分维度优先修 |

## 不做的事（明确排除）

- 不动语音输入线（#729 已交付，正交）
- 不删 AgentRun/记账账本（#742 约束：没有留痕就没有调用）
- 不合并三份评分卡（各评各的，合并制造「哪条判据说了算」的漂移）
- 不在 S1 签署前碰生产 /chat 的数据流
