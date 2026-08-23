# Deep Agent 引擎能力重评（第二轮）— 2026-08-23（SHA 3d327c13）

独立评估会话，不采信上一轮评分、不采信任何口头分数（包括本次任务描述里的转述），
仅依据本会话实际核验到的东西：

1. `git log --oneline -8`（本会话实测，见下）确认基于 main HEAD `3d327c13`，
   包含 #1889 / #1890 / #1900 / #1903 四个新提交。
2. `sse-and-thread-state-evidence-v2/`——外部会话用**修好的探针**（补了
   `stream_mode: ["messages-tuple","updates"]`）重新采集的活体 SSE 证据包，
   本会话对其做了逐条 `grep`/Python 解析核实（见
   `delta-and-tool-event-extraction.txt`），不是照抄描述。
3. 本会话对 main 真实代码 + 测试的核对：`apps/deep-agent-service/tests/test_harness.py`
   （HITL 六个测试）、`tests/test_tracing.py`（D10④ 三个测试）、
   `src/deep_agent_service/guided_research_graph.py`（DA-10 豁免说明）、
   `.harness/state/deepagent-copilotkit-backlog.md` DA-10 条目。
4. 本会话跑通 `uv run --extra dev pytest tests/ -q`：不带 Postgres 47 个用例里
   44 passed / 3 fail（3 个是需要真 Postgres 的用例，`pytest.fail` 早退，符合
   预期不是 bug）；起临时 `postgres:16.14-alpine3.22` 容器（`docker run -d`，
   验证后 `docker rm -f` 销毁，非常驻）后 47 passed（见
   `pytest-run-20260823.txt`，含 hitl/tracing 子集单跑）。
5. 一个独立 Explore 子代理核实了生产前端（`apps/api` + `apps/web`）对
   `messages`/`updates` stream_mode 的实际消费情况（见
   `frontend-wiring-notes.md`）——这是本轮判断 D2/D3 是否真的改判的关键新证据。

## 十维打分

| 维度 | 分（本轮） | 分（上轮） | 依据 |
|---|---|---|---|
| **D1 规划可见性** | **0.7** | 0.7 | 无新证据、无回归。`harness.py:89` 仍挂 `TodoListMiddleware()`；`test_harness.py -k subagent`（含 todos 相关用例）本会话重跑仍全过。证据包里 todos 仍随 `write_todos` 调用真实更新，但仍无前端渲染证据，维持 0.7。 |
| **D2 工具调用透明度** | **0.3** | 0.3 | **分数不变，但依据整体改写**——上一轮的判据（"整条流只有 metadata/values 两种事件，没有任何独立工具调用事件"）是**探针坏掉导致的假象**：本轮修好探针后的 `01-sse-stream.txt` 证实 engine 原生真的会发 `updates` 里的 `tools` 节点事件，每条独立带 `tool_call_id`/`name`/`content`/`status`（见 `delta-and-tool-event-extraction.txt` 的 `TOOL_EVENT ...` 行）——engine 层确实具备「每次调用独立事件」的能力，这一点上一轮判错了。**但** Explore 子代理核实：生产 `apps/api`（`deep-agent-model-provider.ts:633`）从始至终只请求 `stream_mode: ["messages-tuple"]`，全仓 grep 不到任何请求 `"updates"` 的地方——生产链路从未消费这个能力，工具调用可见性是靠检测到 `tool_call_id` 后回头整份重读 `GET /threads/:id/state`，且必须等 `AIMessage.tool_calls[]` 与配对 `ToolMessage` 都齐了才上报一次，是**事后完整记录**，不是独立的开始/参数流式/结果递增事件。唯一带独立 `TOOL_CALL_START/ARGS/END/RESULT` 事件类型的 AG-UI 端点（`copilotkit-agui.controller.ts`）只喂给 `/chat/copilotkit-preview` 预览页，不是生产聊天主链路，且它自己也是把一个**已完结**的 step 一次性拆成固定顺序写完，不是活体递增。end-to-end 交付给用户的仍精确命中 rubric 0.3 档原文「事后可见完整调用记录，过程中不可见」——分数不变，但「为什么是 0.3」从「engine 没有这个能力」纠正为「engine 有，产品没接」。 |
| **D3 真流式** | **1.0** | 0.3（**改判，+0.7**） | 上一轮判据同样建立在坏探针上（"无 messages 流模式，全部是 values 全量重发"）——这是假象。本轮修好探针后：`01-sse-stream.txt` 里 90 条 `messages` 事件，逐条解析（`delta-and-tool-event-extraction.txt`）显示真实的、带毫秒时间戳的增量输出——例如同一条回复的文本内容按 `已完成` → `，结果总结如下：` → `\n\n**我的` → ` 3 步` → `计划（用 write` → `_todos ` … 逐块到达，时间戳从 `1787497912.667` 到 `1787497914.772`，跨度 2.1 秒内 40+ 次到达、每次间隔 50~200ms；`tool_call_chunks` 同样把工具调用的 `args` 拆成 `'{"todos": '` → `'\n[{...}]\n\n'` → `'}'` 三段增量到达。这是真实模型 token/子词级 delta 流出，时间戳直接证明逐步（命中 rubric 1.0 档原文）。**且**这不只是 engine 内部现象：Explore 子代理核实 `apps/api` 的 `onDelta` 把这些 delta 转成 `/agent-runs/:runId/stream` 的 `{type:"delta",text}` 帧，生产聊天面板 `chat-live-message-panel.tsx` 的 `streamingText` 状态逐块 append 渲染——**生产环境的真实用户确实在看真流式**，比 rubric D3 本身要求的「协议+时间戳证据」更进一步。1.0 成立。 |
| **D4 持久化与时间旅行** | **0.7** | 0.7 | 无新提交触及 D4。本会话重新起临时 Postgres 容器，`test_interrupt_survives_process_restart_and_resumes` + `test_time_travel_rollback_and_fork` 本会话重跑仍 2/2 通过（`pytest-run-20260823.txt` 全量 47 passed 一行）。默认仍未在任何部署配置里打开（`build_checkpointer()` 默认走内存态），维持 0.7，不重复上一轮的完整论证。 |
| **D5 子代理委托** | **0.7** | 0.7 | 无新提交触及 D5。本会话重跑 `test_harness.py -k subagent` 4/4 通过，`harness.py:120-161` 委托机制代码未变。默认关（`DEEP_AGENT_SUBAGENTS_ENABLED`），证据包这次的 TC-1 子集仍未触发委托（SSE 里只有 `write_todos`/`list_org_skills`），维持 0.7。 |
| **D6 人在环** | **1.0** | 0.3（**改判，+0.7**） | #1890 落地了 `test_hitl_resume_reject_tool_not_executed` 与 `test_hitl_resume_edit_uses_edited_args`（`test_harness.py:173-234`），本会话实测两个新测试 + 原有 `test_hitl_interrupts_before_sensitive_tool`/`test_hitl_resume_approve_runs_tool` 一起跑，`pytest tests/test_harness.py -k hitl` 6/6 全过（`pytest-run-20260823.txt`）。三态各自都有独立的副作用断言而不只是文本包含检查：approve→`calls==["x"]` 式真实执行；reject→`calls==[]`（dangerous_tool 真实调用次数钉在 0，不是文本里没出现 EXECUTED 就算数）且有明确 `rejected` 通告、run 优雅收尾到脚本下一轮而非挂死；edit→`calls==["edited-by-human"]`（实际执行用的是人改过的参数，不是模型原始提议的 `"x"`）。approve/reject/edit 三种决策类型经真实 `HumanInTheLoopMiddleware` + `Command(resume=...)` 全部验证通过——命中 rubric 1.0 档「批准/拒绝/在线修改参数后放行三态都通」的字面要求。上一轮只验证了 approve 一态，判 0.3（「只验证了三态里的一态」）；现在三态俱全，1.0 成立。（注：验证方式仍是 deep-agent-service 进程内单测 + 假工具，不是经生产前端触发的端到端 HITL 交互——但 rubric D6 原文本身没有像 D1/D2 那样点名要求前端可见，与上一轮判 approve 时使用的证据标准一致，不构成双重标准。） |
| **D7 错误恢复/死循环/预算熔断** | **0.7** | 0.7 | 无新提交触及 D7。本会话重跑 `test_harness.py -k "retry or budget or loop"` 全过（5 passed）。①③达标、②（同工具/文件重复检测的严格等价物）仍是总调用次数硬顶的近似，维持 0.7。 |
| **D8 上下文工程** | **0.7** | 0.7 | 无新提交触及 D8。本会话重跑相关测试全过（含 `test_large_tool_result_evicted_to_file`）。②③本轮证据包里再次能看到工具结果驱逐与 `cached_tokens` 字段（`grep -o '"cached_tokens":[0-9]*'` 在本轮证据包里能命中非零值），①滚动摘要仍无活体触发证据（本轮对话依旧太短，60000 token 阈值未触发）。三项达二，维持 0.7。 |
| **D9 Agent↔UI 双向上下文** | **0.3** | 0.3 | 无新提交触及 D9，也没有专门核实上行注入的新证据。下行：本轮证据包里 `tools` 节点更新事件里 todos 字段仍随执行进度逐步刷新（下行渐进，真实）。上行：Explore 子代理这次核实的重点是 D2/D3 的流式管线，没有发现任何新增的「前端 viewport/selection/客户端变量注入 agent 推理上下文」的实现，全仓依旧 grep 不到 `useCopilotReadable` 等价物。单向，维持 0.3，不因证据包修好而改判（这不是探针问题，是压根没有这个功能）。 |
| **D10 架构纯度与可观测性** | **0.7** | 0.3（**改判，+0.4**） | ①版本地板/lock：`test_version_floor_matches_lock` 本会话重跑仍通过，且该测试挂在 `tests/`（`backend-gates.yml` 等 CI 门控链路里跑的同一套 pytest），是真实 CI 门，不是口头承诺。②middleware 解耦：`harness.py::build_middleware` 全部用官方 `langchain.agents.middleware`/`deepagents` 类型组合，未见私有 hack，未变。①②达标不变。**④可观测性**：#1903 新增 `tracing.py`（挂在 `langchain_core.tracers.base.BaseTracer` 官方回调扩展点上，`graph.with_config({"callbacks": ...})` 是 Runnable 官方支持的绑定方式，不是包一层顶壳）+ `tests/test_tracing.py` 三个测试，本会话实测 3/3 通过：`test_agent_run_produces_a_real_trace_id_linked_to_thread_id`（进程内真图跑一次，落文件的 span 覆盖模型调用/工具调用/middleware 节点、同一 `trace_id`、根 span 带 `thread_id`/`run_id`）、反证 `test_no_spans_without_tracer`（不挂 tracer 就没有 span，证明不是巧合）、`DEEP_AGENT_OTEL_DISABLED=1` 关闭态测试。评测时能拿出真实 trace_id——④ 达标，判定改变（上一轮 `langsmith:false` 全仓无 OTel 是真的，现在有了）。**③无未裁决的平行 loop**：`guided_research_graph.py` 289 行手写 `StateGraph` 依然独立存在，但 #1889 补了文件头核对结论——本会话逐段读过：不是"没试就下结论"，是逐条对照 `harness.py::build_middleware` 七件 middleware 的适用前提（"存在一个自主决定下一步的 LLM 循环"），guided_research 全程零模型调用零工具调用、状态转移由外部 API 显式命令决定，前提不成立，因此不宜强行套用——分析本身扎实。但**关键的治理事实**：人类 2026-08-23 的原始裁决是「迁移到 deepagents」，backlog 原文虽写明"开工前需先验证是否等价，这是本条本身要做的核对，不是新的待裁决点"（即预先授权了这次核对可以推翻迁移结论），但**最终"不迁移"这个结论本身是 agent 单方面下的**，没有看到人类对这个反向结论的显式再确认（不是 GitHub issue 上的人类评论，是 agent 的 PR 描述自称）。按"设计签核是人的动作，agent 不许改状态"的精神，保守处理：**不算③已完全签核**，只算"有实质性技术依据、且核对过程本身被预先授权"，但缺最后一步人类对具体结论的复核确认。因此仍判③未完全达标——命中 rubric 0.7 档「①②达标，③或④缺」（③缺，④已补齐）。相比上一轮③④同时缺（0.3），现在只缺③，从 0.3 升到 0.7；未给 1.0 是因为③这一格还差人类对"不迁移"结论本身的复核，这不是本会话能替人类做的事。 |

**总分 = 0.7+0.3+1.0+0.7+0.7+1.0+0.7+0.7+0.3+0.7 = 6.8 → 向下取整到 0.5 = 6.5**

## 与上一轮（5.0，SHA 6f84375c）的 delta

| 维度 | 上轮 | 本轮 | delta | 原因 |
|---|---|---|---|---|
| D3 真流式 | 0.3 | 1.0 | **+0.7** | 探针修复后证实真实 token 级 delta，且确认打通到生产前端渲染 |
| D6 人在环 | 0.3 | 1.0 | **+0.7** | #1890 补齐 reject/edit 两态测试，approve/reject/edit 三态俱全 |
| D10 架构纯度 | 0.3 | 0.7 | **+0.4** | #1903 补齐 OTel trace（④达标）；③有实质依据但缺人类对最终结论的复核，故非 1.0 |
| 其余七维 | — | — | 0 | 无新证据触及，本会话重新跑测试确认无回归 |
| **总分** | **5.0** | **6.8→6.5** | **+1.5** | |

**D2/D3 是否因为探针修复而改判——直接回答**：
- **D3：是，且是本轮最大的改判**。上一轮"无 token 级流式"的结论本身就是错的——不是
  能力退化后又恢复，是上一轮的证据采集工具本身有缺陷（探针没请求 `messages`
  stream_mode），把"探针没问到"等同于"能力不存在"。修好探针后拿到的是同一个
  SHA 附近、同一套代码路径下真实存在的能力。
- **D2：否，分数不变**，但是通过完全不同的推理路径得到同一个数字——不是"以为
  没有独立事件其实有，所以不变"这么简单，而是"engine 层确实有独立事件能力（这点
  上一轮判错了），但生产集成没有使用这个能力，最终用户体验仍是事后完整记录"。
  如果本次任务的范围是"deep-agent-service 这个 engine 本身"，D2 该上调；但
  rubric D2 的档位定义明确写了"前端逐个渲染"/"前端只渲染部分字段"这类终端可见性
  措辞，是在评「引擎能力+集成」的合力，不是纯 engine 单测。按这个口径，0.3 不变。
  这是本轮里唯一一个"新证据存在但没有改变最终分数"的维度，如实记录，不因为
  探针修复的叙事张力而顺势调高。

## 黄金压测场景 TC-1~TC-5

`apps/deep-agent-service/tests/golden/` 本会话再次确认**仍不存在**——`find` 未变。
DA-09 仍未交付，如实沿用上一轮结论，不重复论证。新证据包（`sse-and-thread-state-evidence-v2/`）
同样只是 TC-1 子集（多步任务 + todos + list_org_skills，无 ≥2 次子代理委托），未构成
正式 TC-1 场景。TC-2/TC-4/TC-5 仍完全未执行；TC-3 的"连续故障注入"证据包里仍是模型
主动拒绝编造，未发生真实工具失败（`05-fault-injection-state.json`，本轮沿用同一份，
未重新采集）。

## 物理证据闭环四类材料

1. **SSE 原始事件流**——齐，且本轮质量显著提升（`sse-and-thread-state-evidence-v2/01-sse-stream.txt`
   含 90 条 `messages` + 22 条 `updates`，不再是探针坏掉时的 metadata+values 两种）。
2. **Checkpointer 数据库快照**——本轮未重新采集（沿用上一轮 `postgres-supplement/`
   逻辑，本会话用临时容器重跑测试验证机制仍然真实，但未重新导出 checkpoint 行——
   如实记录为"未重新采集，机制经测试复核"，不等同于"重新采集齐了"）。
3. **Trace 链路**——本轮**新增齐**：`test_tracing.py` 三个测试本会话实测通过，
   `apps/deep-agent-service/tests/test_tracing.py` 断言 span 数≥4、同一 trace_id、
   根 span 带 thread_id/run_id（PR #1903 描述的 `trace_id=0xec4931f6...` 未在本会话
   重新肉眼核验具体十六进制值，但测试断言本身本会话跑绿，等价核实）。
4. **TC-1~TC-5 逐场景执行记录**——同上一轮，部分缺。

## 违规检查（反伪造一票否决）

未发现前端轮询冒充引擎事件流、事后补录 todo、终态一次性打包伪装成流式、未声明的
mock 通路。D3 的改判基于探针修复后的真实抓包，不是重新解读同一份坏证据；D6 的改判
基于仓库既有测试文件（非本次新写），三态断言均检查了副作用（真实调用计数），不是
只看文本包含。D10③ 刻意没有给满分——即使有技术依据，最终反向结论缺人类复核这件事
本身如实标注，不因为"分析写得扎实"就替人类签字。故无违规记录。
