# Deep Agent 引擎能力重评 — 2026-08-23（SHA 6f84375c）

独立评估会话，不采信任何口头分数，仅依据：
1. `sse-and-thread-state-evidence/`——2026-08-23 采集的活体证据包（原路径
   `deepagent-evidence-20260823T100944Z`，服务指纹 SHA 6f84375c3b5c1b6c7e0f4b438ca3753cc1570641，
   与本次评分的 main HEAD 一致，已核对 `git log -1`）。
2. 本会话对 main 真实代码的逐行核对：
   `apps/deep-agent-service/src/deep_agent_service/{harness.py,graph.py}` +
   `apps/deep-agent-service/tests/*`。
3. `postgres-supplement/`——本会话补充采集：本地起临时 Postgres 容器（已有镜像
   `postgres:16.14-alpine3.22`，未新拉取），跑通此前因缺 DB 而 `pytest.fail` 的
   两个测试文件，全量 pytest 42 passed，容器测试完即销毁（不是常驻基础设施）。

## 十维打分

| 维度 | 分 | 依据 |
|---|---|---|
| **D1 规划可见性** | **0.7** | `harness.py:89` 挂了 `TodoListMiddleware()`。证据包 `01-sse-stream.txt` 显示 `write_todos` 工具调用产生结构化 todos，状态从 `pending→in_progress→completed` 逐步更新（真实工具调用产生，非文本装饰）。**扣分点**：证据只是 curl 落盘的原始 SSE，没有浏览器/前端渲染证据，命中 rubric 0.7 档「前端不可见」。 |
| **D2 工具调用透明度** | **0.3** | 对 `01-sse-stream.txt` 做 `grep event:` 统计：整条流只有 `metadata`（1 次）与 `values`（8 次）两种事件类型，**没有任何按次的独立工具调用事件**（无 `tool_call`/`tool_result` 专用事件名）。每次 `values` 都是全量消息数组重发，新增的调用/结果靠前端自己 diff 才能看出来——不满足 1.0「独立事件」，也弱于 0.7 的默认前提（0.7 假设存在真实的按次事件流，只是前端没渲染全字段）。 |
| **D3 真流式** | **0.3** | 同一份 SSE：无 `messages`（token delta）流模式，全部是 `values`（图每步全量状态重发）。与 rubric 0.3 档锚点文字「协议是 SSE 但内容为终态一次性打包」同构，只是这里是「每步打包重发」而非仅终态一次，本质仍是非增量、非 token 级。 |
| **D4 持久化与时间旅行** | **0.7** | 证据包采集环境未设 `DEEP_AGENT_CHECKPOINT_DB`（`apps/deep-agent-service` 无 `.env`，全仓 grep 不到任何 compose/部署文件接了这个变量），`build_checkpointer()` 返回 `None`——**证据包本身**跑的是 `langgraph dev` 平台内存态（backlog 原话「重启即失」），单看证据包只够 0.3。**但**本会话补充：起真 Postgres，跑通 `tests/test_deep_agent_postgres_recovery.py`（此前两个测试因缺 `DEEP_AGENT_TEST_POSTGRES_URL` 直接 `pytest.fail`，不是新写的凑数脚本）——`test_interrupt_survives_process_restart_and_resumes`（中断态跨进程存活于 Postgres，进程 B 全新建图 approve 恢复，工具真实执行恰好一次）与 `test_time_travel_rollback_and_fork`（`get_state_history` 枚举历史 checkpoint、按 `checkpoint_id` 读回历史状态、从历史节点 invoke 产生真分支）**全部通过**，`postgres-supplement/checkpoint-rows.txt` 里能看到 `da-pg-time-travel` 线程下同一个 `parent_checkpoint_id` 分出两条子链——分支的直接数据库证据。机制真实、经真 Postgres 验证。未给满 1.0：这套能力默认关闭（无任何部署配置显式打开），今天实际跑着的服务观测到的是内存态，1.0 需要「默认即生效」的更强证据。 |
| **D5 子代理委托** | **0.7** | `harness.py:120-161` 注册具名子代理 `org-skill-researcher`，灰度开关 `DEEP_AGENT_SUBAGENTS_ENABLED`（默认关，证据包采集时未设——SSE 里全程只有 `write_todos`/`list_org_skills`，没有 `task` 工具调用，委托未在这次证据包里发生）。本会话跑通 `test_subagent_delegation_really_happens`：三份独立证据同时成立——① 子代理脚本模型被真实消费；② 子代理第二轮输入里带着主线程 config 透传的技能清单（配置真实跨边界传递）；③ 子代理结论通过 `task` 的 ToolMessage 真实归并回主线程。委托机制是真的，不是「守着空气」。未给 1.0：无任何前端可见委托/归属/归并的证据，且证据包里的活体运行从未真正触发（默认关）。 |
| **D6 人在环** | **0.3** | `harness.py:100-117` 用 `DEEP_AGENT_HITL_TOOLS` 接了 `HumanInTheLoopMiddleware`，默认关，证据包采集时未设（也没有 TC-2 场景的证据文件）。本会话跑通 `test_hitl_interrupts_before_sensitive_tool` + `test_hitl_resume_approve_runs_tool`：证明**批准（approve）**这一态确实可用（中断落 checkpointer、resume 后工具真实执行）。但仓库自己的测试里**只测了 approve**，拒绝（reject）与「在线改参数后放行」完全没有任何测试或活体证据——代码注释声称底层中间件支持「四种决策类型」，但这是静态声明，未被验证，按「静态痕迹≠动态事实」纪律不能计入。只验证了三态里的一态 → 0.3。 |
| **D7 错误恢复/死循环/预算熔断** | **0.7** | 证据包 `05-fault-injection-state.json`（TC-3 子集）里模型只是**主动拒绝**编造调用一个不存在的技能，从未发生真实工具失败——①②③ 在这次活体证据里都没有被真正触发。`harness.py:62-96` 配了 `ToolRetryMiddleware(max_retries=2)` / `ToolCallLimitMiddleware(run_limit=40, exit_behavior="continue")` / `ModelCallLimitMiddleware(run_limit=25, exit_behavior="end")`。本会话跑通三条既有测试：`test_tool_retry_recovers_transient_failure`（工具连续报错两次、第三次成功，run 走到终稿，① 达标）、`test_model_call_budget_ends_run_with_notice`（100 轮循环剧本被在 25 次模型调用处优雅拦停，回复里带 `"limit"` 明确通告，不是静默截断或裸异常，③ 达标）、`test_tool_call_limit_injects_correction`（60 轮循环剧本，真实工具执行次数被摁在 40 次阈值内，注入纠偏消息）。**但** ② 的实现是**总调用次数硬顶**，不是 rubric 点名的「同一工具/文件重复操作」专项检测（LoopDetection 等价）——40 次总预算既会漏判「39 次重复同一工具」的真死循环，也会误伤 40 次合法多样调用，是近似而非等价，判 ② 未达标。①③ 达标、②缺 → 命中 0.7 档「①达标，②③缺其一」。 |
| **D8 上下文工程** | **0.7** | ① `SummarizationMiddleware(model=model, trigger=("tokens", 60000), keep=("messages", 20))`（`harness.py:90`）——代码存在，但证据包对话很短，60000 token 阈值从未被触发，无活体证据。② `FilesystemMiddleware(tool_token_limit_before_evict=1000)`（`harness.py:93`）——本会话跑通 `test_large_tool_result_evicted_to_file`：超阈值工具结果被真实驱逐为 `/large_tool_results/<call_id>` 文件引用，正文只留引用，完整内容落 state files，达标。③ 静态段 prompt cache——**证据包自己**的 `01-sse-stream.txt` 里第二轮及之后的模型调用 `response_metadata.token_usage.prompt_tokens_details.cached_tokens` 字段为 `4224`（首轮是 `0`）——这是上游 API 响应里的**真实缓存命中字段**，不是配置存在就算，是本次证据包里含金量最高的一条直接证据。②③ 活体/测试双证达标，① 只有代码没有触发证据 → 三项达二，0.7。 |
| **D9 Agent↔UI 双向上下文** | **0.3** | 下行：证据包 SSE 的 8 次 `values` 事件里 `todos`/`files` 字段随执行进度逐步刷新（不是只在终态出现一次）——下行是真实、渐进的。上行：全仓 grep `apps/web` 与 `apps/api/src/interface/controllers/copilotkit-agui.controller.ts` 找不到任何「前端把 viewport/selection/客户端变量注入 agent 推理上下文」的实现（无 `useCopilotReadable` 等价物、无 client-context 注入痕迹）——上行完全缺失，比 0.7 档要求的「上行静态、仅首次注入」还弱。单向 → 0.3。 |
| **D10 架构纯度与可观测性** | **0.3** | ① 依赖地板与 lock 一致：`test_version_floor_matches_lock` 本会话实测通过——基线「地板 0.0.5、锁 0.7.6」的问题已解决。② middleware 解耦：`build_middleware()` 全部用官方 `langchain.agents.middleware` / `deepagents` 原生类型组合，未发现绕过框架的私有 hack。①②确实达标（相对基线的真实进步）。③ 无未裁决的平行 loop：`guided_research_graph.py`（289 行手写 `StateGraph`，不走 deepagents）依然存在；`.harness/state/deepagent-copilotkit-backlog.md` 记录人类已于 2026-08-23 就此**裁决**「迁移到 deepagents 统一引擎」，但**尚未派工、尚未执行迁移**——平行 loop 今天仍在无收口地跑着，裁决方向已定但现状未变，不算「已签核的存在理由」，判未达标。④ 可观测性：证据包 `00-info.json` 里 `flags.langsmith:false`；全仓 grep `opentelemetry|OTEL` 命中 0 处——评测时拿不出任何 trace ID，判未达标。①②达标但③④同时缺口——rubric 0.7 档只容许「③或④缺一」，两项同时缺不满足，严格按档位退回 0.3（不因①②的真实进步而破例上调，避免评分卡自己成为「从紧变从宽」的先例）。 |

**总分 = 0.7+0.3+0.3+0.7+0.7+0.3+0.7+0.7+0.3+0.3 = 5.0**（已是 0.5 的整数倍，无需再向下取整）

## 黄金压测场景 TC-1~TC-5

`apps/deep-agent-service/tests/golden/` **不存在**（`find` 确认该目录未创建，`tests/` 下只有
`test_deep_agent_postgres_recovery.py` / `test_guided_research_graph.py` /
`test_guided_research_postgres_recovery.py` / `test_harness.py` / `test_model.py` /
`test_tools.py`，没有 golden 子目录）。**如实记录：TC-1~TC-5 作为 rubric 要求的正式黄金压测
脚本未落地**（DA-09 未交付）。这本身是本次评分要如实暴露的缺口——没有临时写脚本凑数。

已发生但**不构成**正式 TC 场景的活体/测试证据（供交叉核对用，不代替 TC-1~5）：
- TC-1 子集（多步任务+todos+list_org_skills，未含 ≥2 次子代理委托）：证据包 01/02。
- TC-2（HITL 修改参数后放行）：**完全未执行**，仓库自身测试也只测了 approve 一态。
- TC-3（连续失败 3 次 + 构造循环）：证据包里的「故障注入」只是模型主动拒绝编造，
  **没有发生真实工具失败**；本会话另跑了仓库既有的重试/预算/纠偏单测（非 TC-3 脚本本身）。
- TC-4（30 轮追问第 2 轮细节）：**完全未执行**。
- TC-5（kill 进程重启续跑+回溯）：**没有按字面执行 kill 真实服务进程**；本会话跑的
  `test_interrupt_survives_process_restart_and_resumes` / `test_time_travel_rollback_and_fork`
  是该测试文件 docstring 自称的「TC-5 的进程内前置版」，用真 Postgres + 独立构图模拟重启，
  不是对已部署服务的字面 kill -9 测试。

## 物理证据闭环四类材料，齐了几类

1. **SSE 原始事件流**——齐。`sse-and-thread-state-evidence/01-sse-stream.txt`（curl 落盘，带毫秒时间戳）。
2. **Checkpointer 数据库快照**——齐（本会话补采）。`postgres-supplement/checkpoint-rows.txt`（真
   Postgres `checkpoints` 表行导出，含时间旅行分支的直接证据）。证据包自带的
   `03-checkpoint-history.json` / `02/04-thread-state*.json` 是内存态平台的 checkpoint 元数据，
   一并保留但不是 Postgres 快照。
3. **Trace 链路**——**缺**。`00-info.json` 显示 `langsmith:false`，全仓无 OTel 导出配置，本次评
   分拿不出任何 trace ID（这正是 D10④ 判 0 的直接依据）。
4. **TC-1~TC-5 逐场景执行记录**——**部分缺**，见上节；只有 TC-1/TC-3 的子集证据，TC-2/TC-4/TC-5
   均无正式记录。

四类里：1 完整、2 完整（本会话补采）、3 缺、4 部分缺（2.5/4，如实记录，不因为差一类就补造）。

## 违规检查（反伪造一票否决）

未发现前端轮询冒充引擎事件流、事后补录 todo、终态一次性打包伪装成流式、未声明的 mock 通路。
本次评分中用到的所有「本会话补充跑通」的测试，均为 main 上早已存在的测试文件（非本次新写），
在本文件与 checkpoint-rows.txt / pytest 输出里如实标注了「补充采集」字样，不与证据包原始文件
混同。故无违规记录。
