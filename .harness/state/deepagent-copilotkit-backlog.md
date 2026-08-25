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
- **状态**：✅ done——早于本 backlog 成文（#695，2026-08-08），本条从写下第一天起
  就是过时描述。`apps/web/next.config.mjs:266` 现有 `${prefix}/copilotkit/:path*`
  rewrite 即为证据（`git blame` 核对）。2026-08-25 复核时发现的 backlog 漂移，
  在此补记，不再是待办。

### DA-02 引擎现代化：middleware 全开 + Postgres checkpointer
- **推动**：D1（规划）、D4（持久上下文）、D8（上下文工程）、D10（架构健康）
- **动作**：
  1. `create_deep_agent` 加 `TodoListMiddleware`、`SummarizationMiddleware`（0.7 的 by-name override 口径）、Filesystem/Subagent 中间件按需
  2. checkpointer：langgraph dev 平台态 → `PostgresSaver`（依赖已在 uv.lock）；注意 guided_research 注释里写的平台限制，需要分环境（dev 平台托管 / 自托管显式传）
  3. `pyproject.toml` 地板提到 `deepagents>=0.7,<0.8`，加 CI 门：地板与 uv.lock major.minor 一致才绿
- **验收**：向端点发多步任务，事件流里出现 `write_todos` 工具调用与 todos 状态更新；重启服务后线程可续。
- **无签署依赖**（deep-agent-service 是 #654 已授权范围）。
- **状态**：✅ done —— #1752「harness 现代化——middleware 全开 + 分环境 checkpointer +
  版本地板门」，已合入 main。`apps/deep-agent-service/src/deep_agent_service/
  graph.py` 的 `create_deep_agent(...)` 调用现接了 `build_middleware`/
  `build_checkpointer`/`build_interrupt_on`/`build_subagents`（`harness.py` 单一
  事实源）。2026-08-25 复核时发现本条在 backlog 里从未标记完成，属于**评分卡
  已经反映真相、backlog 文本未同步**的漂移——`deepagent-capability-rubric.md`
  2026-08-23 评分史（6.5/10，SHA `3d327c13`）D1/D4/D8 各分项的依据本就建立在
  这条工作之上，backlog 正文的缺失是纯文档滞后，不是重新发现的缺口。

### DA-03 真流式桥：deepagents 原生 AG-UI 端点替换 agui-bridge 的假流式
- **推动**：D3（0.3→目标 1.0）、D2、D9
- **动作**：deep-agent-service 起官方 AG-UI 端点（`add_langgraph_fastapi_endpoint` 或 langgraph 平台等价物 + CopilotKitMiddleware），逐事件流出 TEXT_MESSAGE_CONTENT / TOOL_CALL_* / STATE_DELTA；`agui-bridge.ts` 改为纯代理或退役（保留 AgentRun 记账钩子——每个 tool_call 步仍走 `record()`，#742 的账本约束不变）。
- **验收**：curl 事件流，用时间戳证明逐步；`agent_run_steps` 账本无缺步。
- **依赖**：DA-02。**无签署依赖**（还没碰生产 /chat）。
- **状态**：✅ done —— #1755「deep-agent 通路真流式——SSE + 灰度开关 + 轮询回退」，
  已合入 main。`deepagent-capability-rubric.md` D3=1.0（本仓十维里唯一满分项）
  即为这条工作的评分证据。同 DA-02，backlog 正文漂移，2026-08-25 复核补记。

### DA-04 修「每次开新线程」约束：AG-UI 桥支持既有 threadId 续聊
- **推动**：D4、chat-ux 维度 6
- **动作**：桥/端点接受 threadId 复用 checkpointer 线程；无则新建。
- **依赖**：DA-02（有真 checkpointer 才有真线程）。
- **状态**：✅ done —— #1757「deep-agent 线程连续性——Chat thread 决定性映射远端
  thread」，已合入 main。⚠ 注意区分：这条修的是**旧手写轮询面板**这条通路的续聊；
  DA-19g（本会话今天完成）修的是 **CopilotKit 原生新轨道**（`/chat/copilotkit-v2`）
  的续聊——`copilotkit-v2-panel.tsx` 的 `chatThreadIdRef`/`forwardedProps.
  chatThreadId`。两条通路各自独立实现、各自需要各自的续聊修复，不是同一个工作
  被记了两次（本仓"同一事实不得声明在两处"的边界在这里是"同一能力、两条独立
  传输通路，各自的实现各自算数"，不是重复）。

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
- **状态**：✅ done（旧手写轮询面板通路）—— #1763「规划条 AgentPlanPanel——
  write_todos 前端可见化」。⚠ 这是旧 `chat-live-message-panel.tsx` 通路的实现；
  CopilotKit 新轨道的等价能力是 DA-19c（`useRenderTool` 定制卡片，✅ done，见上）
  ——两条通路各自独立落地，不是重复声明同一件事。

### DA-07 人在环：interrupt_on 敏感技能审批
- **推动**：D6（0→1）、chat-ux 维度 9
- **动作**：`call_skill` 按技能风险配置 interrupt_on；前端渲染批准/拒绝/改参三态。
- **依赖**：DA-05。
- **状态**：✅ done（旧手写轮询面板通路 + 引擎侧全链路）—— #1766「人在环
  interrupt_on 引擎侧全链路」+ #1776「人在环 api 传输链——awaiting_approval +
  decision 端点 + resume」+ #1778「人在环前端审批条 AgentApprovalPanel」，三层
  全通。⚠ 与 DA-19d/DA-19g（今天完成）的关系：那两条修的是 **CopilotKit 新轨道**
  （AG-UI/CopilotRuntime 桥接层）的 HITL——此前那条桥接层从未实现过审批语义，
  是全新工作，不是重做这条已完成的旧通路；`resumeAguiBridgeTurn` 复用的正是
  本条（DA-07b，#1776）的 `decideAgentRun` 函数，两条通路共享同一个底层恢复
  机制，只是各自的触发入口不同。

### DA-08 错误透明与恢复
- **推动**：D7、chat-ux 维度 7
- **动作**：RUN_ERROR / tool 失败逐条渲染；agent 侧失败重试策略（deepagents retry 口径）；
  前端失败态持久可见 + 可重试。
- **依赖**：DA-05。
- **状态**：✅ done（工具结果卸载部分，即 rubric D8②）—— #1783「大工具结果驱逐到
  虚拟文件系统，阈值 4KB 口径」。D7（错误恢复/死循环/预算熔断）部分见 DA-09。
  ⚠ 与本次 DA-19g 第 5 轮（今天完成，issue #2012/PR #2013）的关系：那次修的是
  **CopilotKit 新轨道**面板从未订阅 `copilotkit.subscribe({onError})` 总线导致
  `RUN_ERROR` 事件被 `@copilotkit/core` 内部吞掉、错误横幅从不渲染——是新轨道
  自己独立的传输层缺陷，不是这条 DA-08 的重复工作。

### DA-09 harness engineering：PreCompletionChecklist + 死循环/预算熔断 + 黄金压测场景
- **推动**：D7（v2 扩充后的三件套）、chat-ux 维度 4
- **动作**：
  1. `PreCompletionChecklistMiddleware`（退出前对照任务自检，LangChain 同模型 +13.7 分核心件）
  2. **LoopDetection 等价**：同一工具/文件重复操作超阈值注入纠偏
  3. **预算熔断**：最大步数/Token/时间至少两种强制生效，超限安全降级并明确通告（不是静默截断）
  4. **TC-1~TC-5 黄金压测场景脚本**落在 `apps/deep-agent-service/tests/golden/`，
     CI 跑自动化子集——rubric v2 规定每次正式评分必须跑完五场景，这条是评分客观化的地基
- **依赖**：DA-02。
- **状态**：⚠ 部分完成，2026-08-25 复核核实——**第 2/3 点（LoopDetection 等价 +
  预算熔断）已做**：#1813「D7 三件套 + D4 Postgres 恢复实证」，`harness.py` 已接
  `ToolCallLimitMiddleware`/`ModelCallLimitMiddleware`/`ToolRetryMiddleware`。
  **第 1 点（`PreCompletionChecklistMiddleware`）未做**——`apps/deep-agent-service`
  全仓 grep 零命中。**第 4 点（TC-1~TC-5 黄金压测脚本）未做**——
  `apps/deep-agent-service/tests/golden/` 目录不存在（2026-08-25 复核确认）。
  这是 `deepagent-capability-rubric.md` 2026-08-23 评分史自己点名的缺口
  （"TC-1~TC-5 黄金压测脚本目录仍不存在，未临时补写脚本凑数"），backlog 正文
  此前没有对应到具体状态，在此补记为**真实剩余待办**，不是漂移。
- **状态更新（2026-08-25 晚，issue #2051）：四点全部落地，本条收口。**
  - **第 1 点**：上游**有**官方等价件——`deepagents.RubricMiddleware`（0.7.6 公开导出，
    带 `@beta`）。库自己的语义就是「本来要结束时先请 grader 对照 rubric 评一遍，
    判 `needs_revision` 就把差距说明注入回去跳回模型」，与
    「PreCompletionChecklist」逐字对应。按本仓纪律接官方件、不自建：`harness.py`
    的 `build_precompletion_middleware`。middleware 本身无条件挂（无 rubric 时逐字
    no-op），**默认清单的播种**由 `DEEP_AGENT_PRECOMPLETION_CHECKLIST=1` 灰度
    （每次收尾多一次 grader 调用，成本真实变化）。活体反证：TC-3 里 grader 判
    needs_revision → 真的跳回模型返工一轮；关掉开关同一剧本的不合格答复直接成终稿。
  - **第 4 点**：`apps/deep-agent-service/tests/golden/` 五条场景 + 三条反证，
    实测 9/9 通过（TC-5 是真 `SIGKILL` 一个子进程再从 Postgres checkpoint 续跑，
    账本证明第一步没重跑）。**自动化分级表**（哪条 TC 不覆盖什么）写在该目录的
    `README.md`，rubric 已回指。CI 门：`.github/workflows/deep-agent-tests.yml`
    ——⚠ 顺带纠正一条旧的错误记录：2026-08-23 的评分理由书称 pytest「挂在
    backend-gates 等 CI 门控链路里」，实测在此之前**没有任何 workflow 跑过一行
    Python 测试**，那句话是错的，现在才是真的。
  - **顺手抓出来的真问题**（这批脚本的第一份收益）：`SummarizationMiddleware` 的
    `trim_tokens_to_summarize` 此前吃库默认 4000，而触发线是 60000——一次压缩要丢掉
    的四万多 token 里只有最后 4000 会进摘要器，更老的内容**根本没进摘要就没了**
    （实测：30 轮对话触发一次摘要，摘要器只收到第 15 轮一轮的内容）。那不是滚动
    语义摘要，是 rubric D8 0.3 档写的「只有截断」。已钉成与触发线同值，
    `test_harness.py` 有断言看守。**D8 应据此重评**，但按「实现者不自评」纪律，
    本条只登记事实，不改分。

### DA-10 guided_research 平行 loop 的裁决
- **推动**：D10
- **动作**：289 行手写 StateGraph 要么迁移到 deepagents（若 interrupt 语义可覆盖），
  要么在文件头写明豁免理由 + 签核。不允许无声地维持两套。
- **依赖**：DA-02 后评估，产出裁决材料给人类。
- **✅ 人类 2026-08-23 已裁决：迁移到 deepagents 统一引擎**（narrowed A/B 提问，
  非开放式）。开工前需先验证 guided_research 现有的中断/重试路径在 deepagents
  的 interrupt 语义下是否等价——这是本条本身要做的核对，不是新的待裁决点。
- **⛔ 2026-08-23 核对结果：不迁移，真实语义鸿沟，非豁免偷懒**（dev-ai-runtime 执行，
  issue 见 PR 关联）。逐条对照 `harness.py::build_middleware` 的七件 middleware 后
  发现：guided_research_graph.py 全程零模型调用、零工具调用——每次状态转移由外部
  API 显式传入的 `{node, action, requestId, expectedGraphVersion, nodeState}` 命令
  决定，靠 JSON Schema 校验后确定性执行；它借 LangGraph 的 checkpointer + `interrupt()`
  换的是「线程持久化 + 乐观并发（expectedGraphVersion）+ 请求幂等（processedRequests）」，
  不是「工具调用前暂停等人批准」。deepagents 七件 middleware（TodoList/Summarization/
  Filesystem/ToolCallLimit/ModelCallLimit/ToolRetry/HumanInTheLoop）全部以「存在一个
  自主决定下一步的 LLM 循环」为前提，这个前提在这里不成立——没有 agent 循环可以套
  middleware。硬套等价于给每个 node×action 组合发明一个假工具、让 LLM 猜该调哪个，
  这是把确定性 API 驱动的状态转移改造成非确定性的 LLM 猜测，是行为回归不是等价迁移。
  完整核对记录见 `apps/deep-agent-service/src/deep_agent_service/guided_research_graph.py`
  文件头新增的豁免说明。D10「无未裁决的平行 loop」这一维度的扣分点应改记为
  「已核对、有据可查的架构差异」，不再是「未收口」。若未来 deepagents 出现确定性
  状态机类构件（非 LLM 循环控制器），应重新评估。

### DA-11 子代理委托可见化
- **推动**：D5（0→1）
- **动作**：SubagentMiddleware 启用 + 前端渲染「委托给 X」嵌套卡片。
- **状态**：⚠ 部分完成，2026-08-25 复核核实——**引擎侧已做**：#1843「具名研究
  子代理 org-skill-researcher——task 工具不再守着空气」，`build_subagents` 真实
  接线，委托真实发生（PR body 里的删线反证：关掉开关时 `task` 工具报"子代理不
  存在"，证明不是摆设）。**前端"委托给 X"嵌套卡片渲染未做**——`deepagent-
  capability-rubric.md` D5=0.7 的判据文字（"委托真实但前端不可见"）与此完全对应，
  是评分卡已经记录、backlog 正文此前没有对应到具体状态的同一个真实缺口，不是
  新发现。
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
- **依赖**：DA-12 + DA-15（文件事件流）+ **DA-19b**（人类 2026-08-23 裁决：落在
  CopilotKit 原生新轨道上，不搭在即将退役的手写面板上——双栏工作台是新交互主体，
  没理由建在旧壳子里）。

### DA-14 显式/隐式文件上下文注入 ⚠ 需 S1
- **推动**：D9 到 1.0（上行注入是 v2 的硬指标）
- **动作**：
  1. 显式：输入框 `@` 引用工作区文件 + Pin 关键文档；文件胶囊（chips）展示所耗 token 预算
  2. 隐式：前端捕获右栏当前视窗/选中片段，请求时作为「临时文件切片」静默注入
     （useCopilotReadable 通路，**接线基座见 DA-19f**——本条是这条通路上具体注入
     什么内容的权威定义，DA-19f 不重复声明），并可在请求体中验证注入生效
- **依赖**：DA-12、DA-13、**DA-19f**（hook 接线基座）。

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

### DA-17 AG-UI 桥补状态轴 + CUSTOM 通道
- **推动**：D9（下行状态）、DA-13 的传输层
- **动作**：`AguiEvent` 联合类型补 `STATE_SNAPSHOT`/`STATE_DELTA`（RFC 6902 JSON Patch）/
  `CUSTOM {name, value}`，字段形状对齐真实 `@ag-ui/core` zod schema；`write_todos`
  完成时作为首个真实生产者发 `STATE_SNAPSHOT`（解析失败/空结果不发，不造假状态）。
- **状态**：✅ done —— #1842（Closes #1841），已合入 main。

### DA-18 通用声明式 UI schema
- **推动**：per-tool 生成式卡片的复用度
- **动作**：评估是否做一个通用 schema 描述工具调用卡片的渲染形状，替代逐工具各写
  渲染逻辑。
- **✅ 人类 2026-08-23 已裁决：不做**（narrowed A/B 提问，非开放式）。理由：通用
  schema 若做成前端可以脱离真实数据渲染任意结构，等于给「造假 UI」开了一条正当化
  的路——与「不做无后端支撑假 UI」硬红线冲突。per-tool 卡片各自贴合自己的真实数据
  形状（如 DA-06 的工具调用卡、DA-17 的 todos 规划条）更安全，代价是复用度低一些，
  可接受。此条视为关闭，不再是待裁决项。

## DA-19 CopilotKit 原生 Chat 轨道（人类 2026-08-23 裁决：方案 A，灰度迁移生产服务）

> ⚠ **2026-08-24 裁决更新：#654 排除 GraphQL 运行时那条被明确撤回。** DA-19a 落地
> 后核实：`@copilotkit/react-core` 的 hooks（`useCopilotReadable`/`useCopilotAction`/
> `useAgent` 等）在其自带 SKILL.md 里明写 `requires: copilotkit/runtime`——provider
> 内部走 `ProxiedCopilotRuntimeAgent` 代理 `runtimeUrl`，本仓唯一装过的相关包
> `@copilotkit/runtime-client-gql` 包名本身就带 `gql`、依赖 `graphql`。没有绕过的
> 办法：要么撤回 #654 排除 GraphQL 那条、起 `@copilotkit/runtime` 后端适配器，
> 要么放弃「真正用上 hooks」这个目标、继续纯手写。人类 2026-08-24 裁决：**撤回
> #654 的排除，接受 GraphQL 运行时层**——DA-19b 起，各子任务需要新增「起
> `@copilotkit/runtime` 适配器」这个前置步骤，原计划的其余部分不变。
>
> ⚠ 这条更新只改变"要不要接受 GraphQL 层"这一件事本身，`copilotkit-preview-panel.tsx`
> 已经证明的 AG-UI 直连能力不作废——CopilotRuntime 支持把已有的 AG-UI 端点注册为
> `remoteEndpoints`（这是 CopilotKit 官方接 LangGraph/AG-UI 后端的标准方式，
> 不是重新对接一次），新的 GraphQL 层是**包在**现有 deep-agent-service AG-UI 连接
> 外面的一层适配器，不是推翻重来。DA-19a 做的鉴权/续聊/多 agent/错误态加固原样保留，
> 后端适配器要复用这些结论，不能重新发明。

> **背景与裁决过程**：UX-9 冲刺三轮「找 gap→修→评」跑完第一轮（3.0/4）后，人类指出
> 「UI 并没有多大改进」——核实后发现根因：`@copilotkit/react-core`/`react-ui` 已装
> （`apps/web/package.json`），但生产 `/chat` 面板（`chat-live-message-panel.tsx`，
> 2247 行，已超 AGENTS.md 2000 行硬上限）**零个 CopilotKit hook**，全部手写；三轮
> gap 修复本质是在这份手写代码里逐条**手工复刻** CopilotKit 的 UX 模式（进行中态、
> per-tool 卡片、真实建议、HITL 编辑），不是真正接入框架——这解释了为什么分数在涨
> （3.0/4）但用户体感没有质变：每条都是局部效果的手工重造，不是系统性能力。
>
> 讨论 B 方案（只换 `useCopilotReadable`/`useCoAgentStateRender` 两个 hook，壳子不动）
> 时被人类当场否掉：这两个 hook 依赖 CopilotKit 自己的 context provider 管理实际的
> 请求/响应循环——如果发消息的通路仍是手写轮询，`useCopilotReadable` 注入的上下文
> 没有消费者，等于注册进一个没人读的 provider；`useCoAgentStateRender` 同理依赖
> `useCoAgent` 管理真实的 agent 连接。局部换 hook 不做消息循环本身，得到的是两套
> 互不相通的系统，正是「同一事实不得声明在两处」的反面。**结论：要么真正采用
> CopilotKit（框架管消息循环本身），要么不必装这个依赖——中间态没有意义。**
>
> **人类裁决：方案 A**——把生产服务迁移到 CopilotKit 原生驱动的新 chat 轨道，
> 不是继续在手写面板里打补丁。

### 地基已经存在，不是从零开始
`apps/web/components/chat/copilotkit-preview-panel.tsx`（`app/chat/copilotkit-preview/page.tsx`
路由）已经证明：直连 AG-UI `HttpAgent` 可以打通 deep-agent-service 的鉴权/续聊/多
agent/错误态（DA-19a 已加固）。**这份连接层结论不作废**——2026-08-24 裁决更新（见本节
顶部）撤回了 #654 排除 GraphQL 的部分，`@copilotkit/runtime` 后端适配器要把这份已验证
的 AG-UI 连接注册为 `remoteEndpoints`，是包一层，不是推翻重连一次。DA-19 是把
「预览」升级成「灰度生产候选」，不是另起炉灶。

### 纪律：S1=B 双轨灰度（本仓一贯做法，不是新发明）
- 新轨道走独立 flag（暂定 `KERNEL_COPILOTKIT_CHAT_ENABLED`，默认关）。
- 旧手写面板（`chat-live-message-panel.tsx`）**原样保留、不删不改**，直到新轨道
  正式验收通过——本冲刺已合入的一切修复（流式交接、错误呈现、身份统一、遮挡……）
  是旧轨道当前唯一的真实产品体验，不能在迁移期间失去。
- 新轨道用 chat-ux-acceptance-criteria.md 十项 + CopilotKit 对标专项重新评分，
  **只有新轨道分数 ≥ 旧轨道，才考虑把默认值翻转**；旧轨道退役是翻转之后的独立决定，
  本条不包含退役动作。

### 子任务（a 是地基，b 之后除标注依赖外可并行）

**DA-19a 生产级连接**——推动：整条轨道的前提
- 把 `copilotkit-preview-panel.tsx` 的连接方式从「预览」升级为生产可用：真实鉴权
  （bearer token 经 AG-UI 连接正确传递，不是 loopback 桩）、真实 thread 续聊、真实
  多 agent 切换、真实错误传播（连接失败/鉴权失败不能白屏）。
- 验收：真实 deep-agent-service（非 loopback）走一轮完整对话，鉴权失败时有明确
  错误态，thread 续聊后历史正确。
- 无前置依赖，最先做。

**DA-19b 消息渲染迁移**——推动：chat-ux 维度 1/2/8/9/10
- 消息列表迁移到 CopilotKit 原生消息模型渲染，保留产品级定制点（markdown/mermaid
  图/落地为产物按钮）——这些定制通过 CopilotKit 的自定义 render 接入，不是推翻
  官方外观重新发明。
- 依赖：DA-19a。

**DA-19c 工具可见性（框架版 Gap 1/4）**——推动：D2/D9
- `useRenderTool`/`useDefaultRenderTool` 替换 `agent-tool-chain.tsx` 手写的
  per-tool 卡片逻辑，进行中/完成态由框架状态机驱动，不是手动维护 `in_progress`
  记账分支。
- 依赖：DA-19b。
- **状态**：✅ done —— #1990（Closes #1990），PR #1991 合并即签署，merge commit
  `6fad0254` 已确认在 `main` 血统内（`merge-base --is-ancestor` 实测）。
- **实测发现的真实缺口**（如实记录，登记为后续 backend 任务，不在本条范围内修）：
  `apps/api/src/application/agent-run/agui-bridge.ts` 的步骤上报游标在 AG-UI 线上
  丢失工具调用的终态结果文本（4/4 复现，wire 字节实测），旧轮询式 UI 用同一份数据
  正确显示，证明是 AG-UI 桥接层特有的 bug，非前端渲染问题。已用 `spawn_task` 提出
  独立跟进。

**DA-19d 人在环（框架版 Gap 3）**——推动：D6
- `useHumanInTheLoop`（`@copilotkit/react-core/v2` 实际导出的 hook 名——本条最初
  写的 `renderAndWaitForResponse` 是错的，未装过这个符号）替换
  `agent-approval-panel.tsx` 手写审批面板。
- 依赖：DA-19b。
- **状态**：✅ done —— 前端接线（`copilotkit-v2-panel.tsx`，issue #1987）+ 后端
  审批语义（DA-19g HITL 审批语义任务，独立 issue/PR，见下）都已合入 main。
  DA-19d 当时只做了前端 hook 接线，随即实测（`e2e/copilotkit-v2-hitl.spec.ts` 旧版，
  真实浏览器 + 真实 deep-agent loopback 替身）证明 AG-UI/CopilotRuntime 桥接层
  （`agui-bridge.ts`/`copilotkit-agui.controller.ts`）当时从未实现过审批语义：
  待批工具调用的 `TOOL_CALL_END` 后会被立刻错误地补发一个空 `TOOL_CALL_RESULT`
  （`writeToolCallStep` 把 `"in_progress"` 步骤当已完成处理），`useHumanInTheLoop`
  的 `respond` 因此从不出现，approve/编辑/reject 三个按钮永远不会渲染；run 整体
  状态仍卡在 `awaiting_approval`，最终以 `RUN_ERROR AGENT_RUN_TIMEOUT` 收场。这与
  DA-07b/PR #1960 修的 bug 不是同一层——那次修的是旧 REST 审批路径
  （`/agent-runs/:runId/decision`）在**已经支持**审批的前提下 resume 时撞的账本
  序号冲突；这里是**新**桥接层从未实现过审批语义的任何一半。
  **后续修复**（DA-19g HITL 审批语义任务）：`writeToolCallStep` 的 `"in_progress"`
  分支不再提前发 `TOOL_CALL_RESULT`/`STEP_FINISHED`；`runAguiBridgeTurn` 认识
  `awaiting_approval` 中间态，以 `RUN_FINISHED`（不是超时）结束这一轮；新增
  `resumeAguiBridgeTurn`（`agui-bridge.ts`）+ `isHitlResumeRequest`/
  `parseHitlDecision`（`copilotkit-agui.controller.ts`）把 `respond()` 之后框架
  发起的 follow-up `runAgent` 请求路由回同一个被打断的 run，复用 DA-07b 的
  `decideAgentRun`（旧 REST 路径的同一套底层机制，未重新发明）去 resume 它——
  前端接线（`respond()` → `parsedDraft.value` 的编辑值传递路径）当时已经跟旧面板
  逐条对齐，后端补上后没有再改一行。真实浏览器 approve/edit/reject 三条路径证据见
  `e2e/copilotkit-v2-hitl.spec.ts`（改写后的版本，断言修好之后的行为）。

**DA-19e 追问建议（框架版 Gap 2）**——推动：chat-ux 维度
- `useConfigureSuggestions`/`useSuggestions` 替换 `computeFollowUpSuggestions`——
  顺带解决 UX-9 评估发现的缺陷（deep-agent 类线程走不通 `ModelCallPort`，仍是写死
  模板）：框架的建议生成走的是 agent 自己的连接，不需要额外适配 deep-agent 的调用
  形状。
- 依赖：DA-19b。
- **状态**：✅ done —— #1989 合并即签署，已合入 main。
- **实测发现的真实后端缺口**（如实记录，登记为后续 backend 任务）：
  `copilotkit-agui.controller.ts` 忽略 `tools`/`toolChoice`/`forwardedProps`，
  阻塞了建议机制真正走通 deep-agent 侧的工具感知建议生成。已登记，不在本任务
  范围内新增后端实现。

**DA-19f 上行注入基座**——推动：D9（目前 0.3，唯一为 0 的引擎维度）、解锁 DA-14
- 把 `useCopilotReadable` 接进新轨道（provider 级接线，不是具体注入哪些内容——
  具体注入什么、显式 `@` 引用还是隐式视窗捕获，权威定义在 **DA-14**，本条不重复
  声明，只负责把 hook 接线打通，DA-14 在此基座上落地）。
- 依赖：DA-19a（不依赖 b，可与 c/d/e 并行）。

**DA-19g 灰度开关 + 正式验收**——推动：整条轨道能不能翻默认值
- `KERNEL_COPILOTKIT_CHAT_ENABLED` 落地（provision.sh 模板 + 部署文档）；新轨道跑
  完整 chat-ux-acceptance-criteria.md 十项 + CopilotKit 对标专项，独立评分员产出
  分数，与旧轨道当前分数（track B 7/10 本地天花板）对比。
- 依赖：DA-19b~f 全部完成。
- **翻转默认值需要人类确认**——不是评分够了就自动翻，按 ADR-023 精神，这是产品面
  的决定，agent 不自行改默认行为。

**DA-19h 旧轨道退役**——推动：清理债务
- 确认新轨道稳定运行、默认值已翻转一段时间后，删除 `chat-live-message-panel.tsx`
  手写实现。
- 依赖：DA-19g 且默认值已翻转（人类确认）。不属于本轮范围，未来单独排期。

### 完整执行顺序（人类 2026-08-23 裁决：DA-12~16「一切皆文件」路线并入本轨道，持续迭代直到做完）

```
DA-19a（生产级连接，地基）
   ├─ DA-19b（消息渲染迁移）
   │    ├─ DA-19c（工具可见性，框架版 Gap 1/4）─┐
   │    ├─ DA-19d（人在环，框架版 Gap 3）────────┤ 三者互相独立，可并行
   │    ├─ DA-19e（追问建议，框架版 Gap 2）──────┘
   │    └─ DA-12（VFS，后端为主，可与 c/d/e 同时推进）
   │         └─ DA-13（双栏工作台，落在新轨道上）
   │              ├─ DA-15（文件事件流契约，依赖 DA-03 已完成，无额外阻塞）
   │              │    └─ DA-16（局部补丁 + 可视化 diff）
   │              └─ DA-14（显式/隐式上下文注入，权威定义）
   │                   └─ 依赖 DA-19f（hook 接线基座，与 c/d/e 同批可并行）
   └─ DA-19f（useCopilotReadable 接线基座）
DA-19g（灰度开关 + 正式验收，等 b~f 全部完成）
DA-19h（旧轨道退役，等 g 且人类确认翻转默认值）
```

**不是全部做完才验收一次**——每个子任务完工即走 issue→PR→合入 main 的标准流程，
合入即算数；DA-19g 的「正式验收」是对整条轨道的综合评分，不是任何单个子任务的
准入门槛。持续迭代，不在中途因为「这轮该找 gap 了」停下来做表面工作。

### 与三轮 gap 迭代（UX-9 CopilotKit 对标）的关系
不作废——那三轮修的是**旧轨道**（当前生产真实运行的面板），旧轨道在 DA-19h 退役前
仍是用户唯一能用到的版本，continue 修复真实缺陷（HITL edit 从未生效、deep-agent
线程建议仍是模板）依然有意义，不因为决定做 DA-19 就停手上已经定位到根因的两个修复。
但**不再派发新一轮「找 5 个 gap」**——那是对旧轨道的表面缝补，已经被 DA-19 的裁决
取代为系统性方案，继续做等于重复投入两条不会汇合的路。

## CK-P 平价补全 backlog（2026-08-25 人类裁决：「你原来在做的，将旧版本的chat 迁移到copilotkit版本，也不能停，需要全面制定backlog，一步一步的推进」）

> 差距勘探单一事实源：`.harness/state/chat-feature-parity-gap-2026-08-25.md`（11 项）。
> 本节是它的**执行排程**，不重复定义差距本身。已完成 5 项阻断级（持久化 #2028 /
> 附件 #2032 / skill 挂载 #2034 / agent 切换 #2025+#2031 / 默认入口翻转 #2027+#2030）
> 不再列。每项照旧走 issue→PR→merge-base 核验→合入 main 的完整流程。

**CK-P0 路由原生化 + AppShell 框架嵌入**（人类 2026-08-25 原话「路由要改为 chat…
潜入到整体框架」）—— ✅ 已合入 main（#2044 / PR #2049）。

**CK-P1 右栏：上传文件列表（材料）+ 产物栏**（人类 2026-08-25 点名「需要有右边的
上传的文件列表和产物，现在都没有」）—— ✅ 实现完成（#2046 / PR #2048，真栈 e2e
`copilotkit-v2-right-panel.spec.ts` 绿）。
- 复用旧壳 `ChatMaterialsPanel`/`ChatArtifactsPanel` 与其数据链；`ActiveFilePanel`
  （DA-13）留在面板内不动——DA-15 事件至今无真实生产者，生产环境不出现，不为一个
  不出现的面板做布局迁移，等真实生产者落地再统一分区。
- 材料栏头部「+」直传入口（#1758 形态）**未做**：composer 附件控制器含附件线程
  生命周期在面板 Body 层，提升到 shell 是跨三层状态提升；📎 与全 surface 拖拽已在，
  材料栏本轮为读侧。如实登记，不是漏做。
- 差距表 #5「落地为产物」拆出为 **#2050** —— ✅ 实现完成。**取证结论是「不相等」**：
  `copilotkit-agui.controller.ts:578` 的 AG-UI `messageId` 是 `randomUUID()` 现铸的
  wire 级关联 id（首个 delta 早于消息落库，真实主键那时还不存在），照它画按钮必是
  「点了才 404」的假按钮。修法不动流式语义，改补一条映射通道（DA-19a `chat_thread_id`
  的同一个先例）：run 成功后服务端发 `CUSTOM {name:"chat_message_id"}`，前端**只对
  映射到真实 id 的消息**渲染入口（正在流的那条本就还没落库，不该能落地）。入口挂在
  `assistantMessage` 整组件 slot；`markdownRenderer` 子 slot 确认走不通（只暴露
  `content`），别再从那条路进。
- 连带修：`[threadId]` 页上「挂载即另建附件专用线程」（#2032）与持久化线程页
  （#2028）合成后断裂——上传落在新建线程、`send()` 用 URL 线程，`acceptHumanMessage`
  校验 attachmentIds 必须属本线程，带附件发送必 422、右栏材料永远看不到。

**CK-P2 composer 命令：`@` 文件引用 + skill 触发符 `#`→`/`**（人类 2026-08-25
点名，`/` 对齐 Claude Code 习惯）—— ✅ 实现完成（#2046 / PR #2048）。
- 检测规则单一事实源：`apps/web/lib/composer-mention-detection.ts`（纯函数 +
  正反例单测）。`/` 仅行首或前一字符为空白时生效（`src/components`、URL 里的斜杠
  不误触）；`@`/`/` 取更近光标者、遇空白即结束。
- `@` 候选与右栏「材料」是同一份数据（shell 下传），不发第二次请求；选中插
  `@文件名 `，靠 F155 filename 检索召回，不碰 `attachmentIds`。
- `ChatSkillMountPanel` 加 `mentionTriggerChar`（缺省 `#`，旧轨道 `/chat/legacy`
  行为零变化），v2 传 `/`。

**CK-P3 消息级操作**：逐条复制、👍/👎 评分、agent 反馈（差距表 #7）。
✅ 已交付（issue #2054，PR 见该 issue）。三条取证结论修正了原判断，记在这里避免后人重走：
- 「组件现成」只对了一半：`MessageRating`/`FeedbackButton` 确实现成，但**框架本来就有
  一个能用的复制按钮**（`CopilotChatAssistantMessage.CopyButton` 真调 `copyToClipboard`）——
  差距表把复制记成「全无」不准确，它缺的是本仓锚点与被验证过。
- 接入点是 `assistantMessage` **整组件** slot（携带 `message`），不是 `markdownRenderer`
  子 slot（只有 `content`，#2046 已排除）。这同时证实了 #2050 的调查结论。
- ⚠ **评分曾被认为不需要 id 对齐，实测是错的**：`submit-message-rating.ts` 三道门
  （`findMessageLocation` / 可见性 / 归因）任一不过一律 404，而 wire 上的
  `TEXT_MESSAGE_START.messageId` 是 `copilotkit-agui.controller.ts` 的 `randomUUID()`。
  本轮在源头补上：run `succeeded` 后回显 `CUSTOM {name:"chat_message_id"}`
  （契约 `@repo/contracts/agui-state-events` 的 `AguiChatMessageIdValue`），前端
  `useChatMessageIdentity` 解析不出真实 id 就不画评分按钮。
  **副作用：#2050（「落地为产物」入口）卡住的那个前提由此解除**——`landAsArtifact`
  走的是同一道 `findMessageLocation` 门，现在同一个索引就能给出可用的落库 id。
  #2050 本身仍未做（本轮范围只到评分），接手时直接复用
  `lib/copilotkit-v2-message-identity.ts`，不要重新排查 id 是否对齐。

**CK-P4 Run 进度细节**（差距表 #9 未覆盖部分）。
✅ **部分交付**（issue #2054）：耗时计时、阶段文案、45s longrun 提示、失败重试按钮。
❌ **如实登记为不做**（v2 侧没有真实数据源，逐维核实见
`apps/web/lib/copilotkit-v2-run-progress.ts` 文件头）：
- **上下文快照 L1-L3**（`MessageContextSnapshot`）——读的是 `AgentRunView` 上的上下文
  层级字段，AG-UI 协议里不存在这个概念，v2 轨道不轮询 `GET /api/agent-runs/{id}`。
- **逐条消息思考链**（`MessageThinkingChain`）——同上，依赖 run step 明细。
- **`AgentRunStatus` 权威状态条**——v2 的状态来自 AG-UI 事件流，没有权威 run 状态查询。
要做这三样，前置条件是「v2 轨道也拿得到 run id 并轮询 `AgentRunView`」，那是一个独立
的接线任务（与 CK-P 其它条目无依赖），谁做谁先立项，不要在没有数据源时先画面板。
- ⚠ longrun 提示措辞比旧轨道**收窄**：旧轨道按 `hasMountedSkills` 分岔，v2 面板 body
  拿不到该状态（`ChatSkillMountPanel` 自持不上抛），只说通用那句。issue #1803 gap #4
  正是被这句错归因坑过一次，宁可笼统不猜。

**CK-P5 会话录音归档**（差距表 #8）—— ⛔ **契约级阻塞，本轮如实登记不做**（#2053）。
平移做不了，两条互相独立的硬事实（读契约与路由确认，不是文件名推断）：
① `recording.ts` 的 `startRecording.in.projectId` 是 `z.string()`（**非空**），err 含
`NO_PROJECT_ROLE`，服务端 `requireProjectRole` 按项目角色判权；
② v2 外壳的线程**全部**是个人线程（`createPersonalThread(null)` 建、`listPersonalThreads`
列，`projectId === null`），带 `?projectId=` 的项目内对话在 `/chat` 上至今仍路由到旧屏
`ChatReadScreen`（差距表第 1 项未收敛的另一半）。
⇒ v2 轨道上不存在任何一条能合法开始录音的线程。挂一个恒不满足渲染条件的面板 = 死代码；
挂一个不判条件的按钮 = 必然 400/`NO_PROJECT_ROLE` 的假按钮。解锁二选一、都要人类签核：
(a) v2 接入项目线程（差距表 #1 剩余半边），录音随项目上下文自然可用；
(b) 放宽 `startRecording` 契约让个人线程可录——授权矩阵与保留期在「无项目」时按什么
判据解析，是需要重新签核的设计问题，不是加个 `.nullable()`。

**CK-P6 生成用户画像**（差距表 #6，`summarizePersonaFromThread` 入口平移）—— ✅ 实现完成
（#2053）。锚点 `messageId` 取**持久化** `chat_messages.id`（点击时现读 `listMessages`），
不是 `agent.messages` 的 AG-UI 流式 id——两者是不同命名空间，拿后者会做出「点了才报错」
的假按钮；这条由组件测试的反证实验实测钉住（第一版断言两份消息一模一样，把实现改成拿
内存末条 id 照样全绿，随后重编排为「挂载后后端才多出一条」才真能判）。

**CK-P7 多 agent 编制**（#2025 收窄时明确延后的另一半）—— ✅ 实现完成（#2052）。
- `RosterPanel`/`ErrorState`/`describeMutateFailure` 与旧轨道收敛成共用件，不各画一份。
- ⚠ 开工时发现**服务端这条路对个人线程根本没通**，不是前端接一下就行：两个编制端点
  把 `projectId` 声明成必填（没有 `getThread` 早就在用的「省略 ⇒ null ⇒ 个人线程」
  归一化），且写权判据 `outcome.actor.projectRole` 对个人线程恒为 `null` ⇒ 线程创建者
  被自己的线程 403。按 `land-as-artifact.ts` 2026-08-21 那条人类裁决过的个人线程豁免
  同一条理由补齐；项目线程分支一个字没动。
- ⚠ **验收锚点勘误**：线程卡上的「N 个 agent」**不是**编制计数。
  `thread-badges.ts:113` 是 `new Set(speakingAgentIds).size`，`ports.ts:147` 逐字
  定义为「在本线程**发过言**的不同 agent id」——加进编制但还没发言时那个数本就不该变。
  真锚点用 `getAgentPanel.rosterCount` + 刷新后仍在 + 服务端复核。

**CK-P8 归档线程只读态**（差距表 #11）—— ✅ 读侧接通（#2053），写侧缺口如实登记。
`chat_threads.archived` 真实存在、`getThread.out.thread.archived` 真实下发、`getThread`
对归档线程**不**抛错 ⇒ 只读态接的是真数据，不是前端编的假状态。归档时 composer 的
input / 发送 / 麦克风 / 设备选择器 / 📎 / 拖拽落区 / 追问建议 / 画像入口**全部**禁用或不渲染，
提示文案与锚点（`chat-composer-archived`）与旧轨道逐字同套。
⚠ 两处缺口需要契约新增 + 签核，本 issue 未擅自加：
① `mutateThread.in.op` 只有 `create | rename | delete`——**契约里没有 archive 操作**，
   用户从任何界面都归不了档（因此端到端"真归档一条线程"在产品里不存在，e2e 只能
   把 `getThread` 真实响应里那一个布尔翻过来，证明前端对真实字段的反应）；
② `ThreadCard`（列表项）没有 `archived` 字段 ⇒ 左栏无法给归档线程加标记。

排序依据：P0-P2 人类点名 → P3/P4 用户高频感知 → P5-P8 尾部。与 UIUX 三轮视觉
迭代、默认 agent 健壮化两条在途线并行推进；机器容量按「同时最多 3-4 条实现线」
节流（parallel-dispatch-machine-capacity 教训），完成一条放一条。

## UX-9 冲刺（2026-08-23 人类裁决：以 UI 主卡到 9 分为目标，subagent 并行，全程无人类参与）

评分循环：改代码 → shots 真栈取证（慢速档）→ 独立评分员看图 → 实锤 → 下一轮。
两轮评分（各 1/10 证据分）已把「取证不足」与「真实缺陷」分干净，本冲刺按线并行：

| 线 | 范围 | 打哪几项 | 状态 |
|---|---|---|---|
| **A**（coord-architecture） | 流式交接无缝（草稿活到持久消息落位）· run 过程区独立于瞬态气泡（终态留存 3/3）· 折叠头不早下结论 + 逐工具参数摘要 · 三场景取证（展开态/markdown/真实失败） | 1 / 2 / 3 / 7 / 8 | v8 自证：streaming行=true×6、规划条留存到终态 |
| **B**（dev-chat-e2e 并行） | 一致性五处：右栏双态并存 ·「真实」等开发者词汇外泄 · 录音红色语义冲突 · agent 名称中途改写 ·（遮挡留 A） | 10 / 5 | 进行中 |
| **C**（dev-chat-e2e 并行） | loopback 多步剧本（第二工具参数引用第一工具结果）+ 展开态取证——「看结果→定下一步」的链条可判 | 4 / 3 | #1855 PR 待合（原 #1835 因 stack 在已 squash 的 A 分支上产生假冲突，重开） |
| **D1**（dev-chat-e2e） | 删除无后端支撑的假数据右栏 chat-right-panel（原型专用，157 行纯 mock） | 反假数据/诚实度 | #1840 PR 待合 |
| **D2**（dev-ai-runtime） | DA-17：AG-UI 桥补状态轴 STATE_SNAPSHOT/DELTA + CUSTOM 通道，write_todos 作首个真实生产者 | 9（下行状态） | #1842 PR 待合 |
| **D4**（dev-ai-runtime） | HITL edit 三态——契约/DB/应用/provider 四层，edited_action 字段形状实测（非猜测） | 6（人在环） | #1848 PR 待合 |
| **D5**（dev-ai-runtime） | 具名研究子代理 org-skill-researcher，真实委托三证据 | 11（子代理委托可见） | #1843 PR 待合 |
| **D3**（A/B/C 全合并后） | 上行上下文注入（useCopilotReadable 等价：视窗/选中→run 上下文）· DA-12 VFS · DA-13 双栏工作台——前端消费 D2 落的 STATE 事件 | 9 + 架构下半场 | 排队，等 C(#1855) 合并 |
| 活体半边 | 真实模型的 4/6 质量判定、真实麦克风的 5——devapp 取证（live-evidence workflow #1823） | 4 / 5 / 6 | 需部署环境 |

并行纪律：文件级禁区互斥（A 持 panel/tool-chain，B 禁入；C stack 在 A 分支；D1/D2/D4/D5 各自独立文件域，互不相扰）；
机器容量上限 3 条并行（parallel-dispatch 教训：四条线 load 50）。
命名说明：原「线 D」拆成 D1/D2/D4/D5（已完工待合）+ D3（依赖 A/B/C 全合并，未开工）——避免把「D 排队」和「D1/D2/D4/D5 已完工」两个事实叠在一处。

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
