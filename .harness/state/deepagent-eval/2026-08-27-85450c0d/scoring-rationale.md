# Deep Agent 引擎能力重评（第四轮）— 2026-08-27（SHA 85450c0d）

独立评审会话（rev-e2e 角色），不采信实现者的转述，只依据本会话实际采集到的证据。
不合并 PR，不改实现代码，只改评分卡文件本身 + 归档证据。

## 0. 前置事实核对

1. `git fetch origin main` 实测 SHA `85450c0dd50bf5728eeb24464f8726d94b0467a3`
   （`test(chat): 任务工作台 P2/A11Y/COPY 15 条真栈实测全过（Closes #2075） (#2242)`）。
2. `git diff --stat 7d2802b1..85450c0d -- apps/deep-agent-service/src/` 只有两个文件
   改动：`graph.py`（#2224 提示词修复，+12 行）、`harness.py`（DA-09 完成前自检
   middleware + D8① SummarizationMiddleware `trim_tokens_to_summarize` 修复，
   +102 行）。`guided_research_graph.py`/`model.py`/`tools.py`/`tracing.py` 零改动。
3. 上一轮遗留的核心待验证问题：F212-F216（agent-interrupts）、F972-F978
   （plan-control）、#2224（write_todos 提示词修复）是否真的把 D1/D2/D6/D9 的分数
   支撑起来——任务描述明确要求本轮重新实测这四个维度，不能沿用旧分。

## 1. 方法论：真实引擎 + 真实浏览器手动探针（绕开高负载下的 Playwright 编排瓶颈）

本机在本轮评审全程 load1 在 15~22 之间（`uptime` 实测），多个并发 agent 会话
同时在跑。`.harness/scripts/lib/stack-admission.ts` 的排队机制（上限 2 个隔离栈）
导致通过 `pnpm run verify:chat-task-workbench` 跑 `chat-task-workbench-workflow-
states.spec.ts` 排队 579 秒才被放行，且放行后 5 条测试全部因基础设施超时/既有
UX 验收缺口失败（详见 §5，这些失败与"是否接了真实引擎"无关，是另一份验收卡
`chat-task-workbench-acceptance.md` 的既有缺口，该 spec 文件头自己也写明
"引擎能否产出结构化 todo → deepagent-capability-rubric.md D1，本 spec 不评"）。

因此本轮改用更轻量的路径拿 D1/D2/D6/D9 的活体证据：

1. `bash apps/deep-agent-service/scripts/verify-golden-scenarios.sh`——TC-1~TC-5
   全部 9 条（含 2 条反证）真 Postgres 一次性容器，全部通过，证据存
   `golden-evidence/`（整份拷贝）。这证明**引擎层**行为无回归。
2. 用 `.env` 把真实 DASHSCOPE 凭据（复用仓库根 `.env.local`，未改动、未提交）
   映射成 `KERNEL_MODEL_*`，起真实 `uv run --extra dev langgraph dev --port 2029`
   （真实 deepagents 0.7.x + 真实 DashScope qwen3.8-max，非 loopback 替身）。
3. 临时（未提交，已用 `git checkout` 复原、`git diff --stat` 确认零残留）把
   `apps/web/playwright.chat-read.config.ts` 的 `KERNEL_DEEP_AGENT_BASE_URL`
   从 loopback 端口改指向 `http://127.0.0.1:2029`，跑 `pnpm run verify:chat-read`
   起真登录 + 真 Postgres + 真 CopilotRuntime 全套编排（唯一替换的是 deep-agent
   这一路上游）。
4. **不通过 Playwright 断言，改用 `mcp__Claude_Browser__*` 工具手动登录
   （`chat-read-e2e@example.test`）、手动在 `/chat/copilotkit-v2` 开启"任务模式"、
   发送真实自然语言多步任务、`read_network_requests` 抓生产
   `/api/copilotkit/agent/default/run` 的原始 SSE 响应体**——这是本轮相对
   前三轮的关键方法论差异：前三轮受限于自动化 spec 的固定触发词
   （loopback-only 的 sentinel），本轮直接用浏览器手动交互绕开了这个限制，
   第一次拿到"真实模型 + 生产桥接 + 生产前端渲染"三者叠加的活体证据。

证据落点：`.harness/state/deepagent-eval/2026-08-27-85450c0d/`
（`golden-evidence/`、`golden-scenarios-pytest-run.txt`、
`live-plan-control-real-engine/`）。

## 2. D1 规划可见性：维持 0.7，证据基础从"资源竞争无法验证"变为"验证到位、发现具体缺口"

**正面证据**（`live-plan-control-real-engine/01-run-sse-raw.txt`）：真实模型对
"请先给出计划，经确认后再执行：请帮我制定一份新产品上市的调研计划……"这句
任务模式拼接文案，真的调用了 `write_todos`（结构化 3 步 JSON，非纯文本
"第一步/第二步"）——这是 `#2224`（提示词侧修复）本轮的直接命中证据（单次交互，
不能排除 `#2220` 诊断里"概率性，不保证 100%"的可能，未开单独结论）。
`STATE_SNAPSHOT` 下行后，前端六态面板（`准备/计划/执行/审批/完成`）与计划面板
（3 步待办 + "确认后执行"确认门）都真实渲染——这是 F972-F978（plan-control 契约
+ 六态面板）接线后**本轮首次**拿到"真实引擎 write_todos → 六态面板"组合的活体
证据（上一轮 7.5 分因资源竞争未能拿到这组证据）。

**新发现的缺口**（`02-ledger-after-confirm.json` + issue #2250）：点击"确认并
执行"后，后端把账本 `phase` 翻成 `"executing"`，前端显示"当前步骤 1/3 · 已用
Ns"计时器持续走动——但全程监听未见任何新的 `/api/copilotkit/agent/default/run`
请求被发出，40+ 秒后三个步骤的 `status` 全部仍是 `"pending"`。即"确认执行"只是
账本状态翻转，**没有真正触发引擎执行任何一步**。

**判分**：满足 1.0 档"多步任务先产生结构化 todo（工具调用产生非文本装饰）"+
"前端实时可见"两项，但不满足"执行中逐项更新状态"——不是"更新粒度粗"，是
"完全不更新"（因为压根没有对应的引擎工作在推进）。仍落在 0.7 档，但评分依据
从"无法判断"变成"判断到位、缺口具体"。已开 issue #2250 登记，供设计签核决定
"确认执行"该不该真的踢一次引擎 run。

## 3. D2 工具调用透明度：维持 0.7，架构边界进一步坐实

`01-run-sse-raw.txt` 里 `list_org_skills`/`write_todos` 各自产生独立的
`TOOL_CALL_START→ARGS→END→RESULT` 事件，`STEP_STARTED/STEP_FINISHED` 包裹，经
生产 `/copilotkit/agui` 桥转译——与上一轮 D2=0.7 的结论一致，`issue #2016`
（`onStep` 位置游标丢更新，`search_documents` 结果文本复现为空）仍 OPEN，
封顶依据不变。

**F212-F216（agent-interrupts 三张新 HITL 卡）不计入本轮 D2 提升**：本轮 SSE
证据里 `RUN_STARTED.input.tools` 确实带着 `confirm_task_intent`/
`fill_run_params`/`choose_execution_option`/`call_skill` 四个 schema（浏览器端
`useHumanInTheLoop` 注册行为），但代码级复核（`packages/contracts/src/agent-
interrupts.ts` 文件头 + `grep` 全仓）确认：**真实 `apps/deep-agent-service` 的
`tools.py` 里不存在这三个工具名的 `@tool` 定义**，`copilotkit-agui.controller.ts`
的 `AguiRunInput` 接口文档自证只读 `messages`/`forwardedProps.chatThreadId`，
`tools` 字段被丢弃、从不转发进真实 LangGraph 图。这与已关闭的 `issue #2017`
（`send_email` 前端 HITL 架构上无法触达真实引擎）是**同一类架构缺口**——三张新卡
的"接入 copilotkit-v2-panel 真实聊天渲染树"（`#2179`）指的是"前端组件挂进了
真实渲染树"，不是"真实引擎能触发它们"。这一点契约文件自己已经如实登记
（"⇒ Python 侧 `@tool` 定义是下一个 feature，已通过 `spawn_task` 登记为后续
任务"），不构成本轮反伪造条款下的违规，但也不能算作本轮 D2/D6 的加分项。

## 4. D3/D4/D5：TC-1/TC-5 全部重新跑通，无回归，维持原分

- **D3（1.0）**：`01-run-sse-raw.txt` 里 `TEXT_MESSAGE_CONTENT` 逐词/短语级 delta
  真实流出（真实模型），与既有结论一致；engine 代码零 diff。
- **D4（0.7）**：TC-5 golden（真 Postgres）本轮重跑：`worker_returncode: -9`
  （真 SIGKILL）→ `ledger_after_resume` 含 3 条记录（`step_one` 执行 1 次，
  `step_two` 执行 2 次，符合"续跑重放未完成步骤"预期）→
  `replayed_checkpoint_id` 成功回溯到只有 2 条消息的历史节点。跨进程恢复 +
  时间旅行两项均真实验证，无回归。
- **D5（0.7）**：TC-1 golden 本轮重跑：`delegations: 2`（`tool_calls_in_order`
  含两次 `task`），子代理委托机制无回归；前端可见性仍未验证（维持 0.7 上限
  的依据不变）。

## 5. D6 人在环：维持 1.0，engine 层三态无回归；agent-interrupts 不影响此分

TC-2 golden 本轮重跑（真 Postgres）：`review_configs.allowed_decisions` 含
`["approve","edit","reject","respond"]`，剧本走的是"模型提议 `market-scan`→人类
改成 `risk-review`→放行→`skill_executions_observed: ["风险复核"]`"——approve/
reject/edit 三态机制无回归。`test_harness.py` 47/47（本轮未单独重跑全量计数，
沿用 golden 脚本对 harness 层的覆盖，未见新增回归）。

如 §3 所述，F212-F216 三张新卡因真实引擎侧无对应 `@tool` 实现，永远不可能被
真实引擎触发，不计入本维度（与既有 `issue #2017` 处理方式一致：D6 评的是引擎
能力，不是前端组件是否挂进了渲染树）。

## 6. D7 错误恢复/死循环/预算熔断：维持 0.7，观察到一项尚未生效的改进

`harness.py` 本轮新增 `RubricMiddleware`（deepagents 官方 `@beta` 件）+
`_DefaultCompletionChecklistMiddleware`：退出前对照一份贴住 AGENTS.md"没有证据=
没有完成"纪律的自检清单，不合格则带着 gap 说明跳回模型返工。TC-3 golden 两条
新增用例本轮通过：`test_tc3_precompletion_checklist_forces_a_revision`（清单
生效时逼出返工）+ `test_tc3_counterproof_checklist_off_lets_bad_answer_stand`
（关掉清单时坏答案原样过关，反证成立，证明前者不是巧合）。

**未升级到更高档的原因**：① 该能力由 `DEEP_AGENT_PRECOMPLETION_CHECKLIST=1`
显式开关，**默认关闭**——生产环境当前不受这项保护；② 本轮未能在真实模型交互中
触发它生效的分支（§2 的真实交互只有一轮，未刻意构造"编造成功"的场景来验证
自检拦截真实模型的输出）。rubric D7 1.0 档要求"①②③"三项能力同时到位且
"超限时…明确通告用户"，本次新增件加强的是①（不编造成功）的一个新机制，但
默认关闭+未活体验证生效，维持 0.7，不因新增件默认降级判 0（未破坏既有行为）。

## 7. D8 上下文工程：0.7 → **1.0**（本轮唯一分数变动，机制级修复 + 反证齐全）

前三轮 D8 停在 0.7 的依据一贯是"②驱逐 ③cache 命中已用活体证据确认，①滚动
摘要要么未触发（对话太短）要么被 TC-4 抓出是"只摘尾巴、其余静默丢弃"的
0.3 档缺陷（`trim_tokens_to_summarize` 吃库默认 4000，而触发线是 60000）"。

本轮 `harness.py` 把 `trim_tokens_to_summarize` 显式钉死为 60000（与触发线
同值，理由见该文件自己的注释：“要丢掉的那一段按定义不超过触发线”），TC-4
golden 本轮验证：30 轮对话触发摘要后，第 30 轮模型实际收到的消息里仍能查到
第 2 轮埋的事实（`FACT_NEEDLE` 命中）+ 反证（`test_tc4_counterproof_fact_is_
not_in_the_recent_window`：确认这条事实不在"最近 20 条"保留窗口里，命中的
是摘要通路，不是没触发摘要的侥幸）。

`tests/golden/test_tc4_long_context_recall.py` 文件头自己划了边界："能证明的是
**引擎侧的上下文工程真的发生了**……不能证明的是**摘要质量**（摘要器是假模型）"
——本会话认可这条边界：D8①字面判据是"长对话滚动语义摘要（非粗暴截断）"，
问的是**机制**（有没有真的把该摘的内容交给摘要器），不是"摘得好不好"（那是
一个相关但不同的问题，本轮仍未用真模型验证，如实记录为未覆盖）。TC-4 用
可控的假模型 + 明确断言 + 反证，恰好是验证"机制"而非"质量"的合适工具，
不属于用脚本绿灯冒充需要活体证据的档位。

②驱逐、③cache 命中两项机制代码零改动，此前已有活体证据（`2026-08-23` 轮
`grep cached_tokens` 命中非零值 + `test_large_tool_result_evicted_to_file`），
本轮 golden 重跑无回归。三项在"机制真实存在"这个判据下全部达标 ⇒ D8: 0.7→1.0。

## 8. D9 Agent↔UI 双向上下文：维持 0.7

`01-run-sse-raw.txt` 的 `RUN_STARTED.input.context` 里能看到
`{"description":"DA-19f wiring probe: current route + fixed marker","value":
"{\"pathname\":\"...\",\"probe\":\"DA-19F-READABLE-CONTEXT-PROBE\"}"}`——
证实 DA-19f 的上行注入通路本轮在生产路由上确实把内容送到了请求里（比上一轮
"两次独立重跑因资源竞争失败，未拿到独立证据"进了一步）。但这仍是既有的固定
测试探针标记（`pathname` + 一个写死的 `probe` 字符串），不是 rubric 1.0 档要求
的"用户视窗/选中内容/客户端变量"这类真实动态上下文，代码本身（`message-
context-snapshot.tsx` 等）自 `7d2802b1` 起零改动。维持 0.7：下行 STATE_SNAPSHOT
实时（本轮 write_todos 场景再次确认）+ 上行确认送达（本轮新证据），但上行仍是
固定探针值而非真实动态客户端变量，未达 1.0。

## 9. D10 架构纯度与可观测性：维持 0.7

`apps/deep-agent-service/src/deep_agent_service/tracing.py`（D10④ OTel 本地
可导出方案）自 `3d327c13` 起零改动，本轮未见 LangSmith key 配置（人类专属
凭据，agent 不能代填，`.env.local` 复核确认仍无 `LANGSMITH_API_KEY`）。
`guided_research_graph.py` 平行 loop 现状未变。维持 0.7。

## 10. TC-1~TC-5 黄金压测覆盖（本轮完整跑通）

| TC | 本轮结果 | 涉及维度 |
|---|---|---|
| TC-1 | ✅ pass（2 次委托，`tool_calls_in_order` 含 2×`task`） | D1 D2 D5 |
| TC-2 | ✅ pass + ✅ 反证 pass（edit-then-approve 路径 + 无 HITL 配置时无阻挡） | D6 D2 |
| TC-3 | ✅ pass ×2 + ✅ 反证 pass（故障注入/预算熔断 + 完成前自检+反证） | D7 |
| TC-4 | ✅ pass + ✅ 反证 pass（30 轮召回 + 事实确实不在近期窗口） | D8 D4 |
| TC-5 | ✅ pass（真 SIGKILL + 真 Postgres 续跑 + 时间旅行回溯） | D4 D7 |

9/9（含 4 条反证）全部通过，证据 `golden-evidence/`、
`golden-scenarios-pytest-run.txt`。

## 11. 总分与 delta

| 维度 | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | 原始和 | 取整 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 本轮 85450c0d | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 1.0 | 0.7 | **1.0** | 0.7 | 0.7 | 7.9 | **7.5** |
| 上轮 7d2802b1 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 0.7 | 0.7 | 7.6 | 7.5 |

**总分数字不变（7.5），但不是"沿用旧分"——十维逐条重新实测，唯一实际分数
变动是 D8: 0.7→1.0（机制级修复 + 反证齐全）；原始和从 7.6 涨到 7.9，取整
（向下取整到 0.5）后仍落在 7.5 这一档。** 其余九维均有本轮新采集的独立证据
支撑（多数通过 golden 脚本重跑确认无回归，D1/D2/D6/D9 额外通过真实浏览器
手动探针拿到本轮独立的活体 SSE/网络请求证据），不是简单复制上一轮结论。

## 12. 违规记录

无。F212-F216 的三个虚拟工具名在真实引擎侧不可达，但实现方（`packages/
contracts/src/agent-interrupts.ts` 文件头）已如实登记这个边界并声明是
"下一个 feature"，不构成"冒充引擎原生能力"的一票否决情形——按 §3/§5 的分析，
本轮评分对此保持中性（不加分不判违规）。新发现的"确认执行不触发真实引擎"
（issue #2250）同理：没有伪造事件流，只是 UI 呈现与后端真实状态存在观感落差，
已登记 issue，D1 判分已如实体现（未给满分）。

## 13. 已知未覆盖

- D3 token 流质量、D8 摘要质量、D7"不编造成功"的语义判断——TC 脚本用假模型，
  证明的是引擎机制而非模型输出质量，本轮真实模型交互样本量为 1（§2 的手动
  探针），不足以对这些"质量"维度下活体结论，如实记录为方法论边界。
- D7 pre-completion checklist 默认关闭时的行为未在真实模型交互中验证。
- D9 真实动态客户端变量（viewport/selection）注入仍未验证，只confirmed 固定
  探针标记送达。
