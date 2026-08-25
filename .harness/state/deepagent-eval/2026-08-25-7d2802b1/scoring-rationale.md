# Deep Agent 引擎能力重评（第三轮）— 2026-08-25（SHA 7d2802b1）

独立评估会话，不采信上一轮评分、不采信任务描述里的任何转述（包括对 D2/D6/D9
"可能改判"的提示——那些是提醒去核实的方向，本轮结论只依据本会话实际核验到的东西）。

## 0. 前置事实核对

1. `git log --oneline -3` 实测确认基于 main HEAD `7d2802b1`（"DA-01~11 状态漂移修复"
   PR #2014，与上一轮评分基线 `3d327c13` 之间隔着 DA-19a/b/c/d/e/f/g 全部提交）。
2. `git diff --stat 3d327c13..HEAD -- apps/deep-agent-service/` **空输出**——Python
   引擎本体（`harness.py`/`graph.py`/`model.py`/`tools.py`/`tracing.py`/
   `guided_research_graph.py`）自 3d327c13 起零改动。这意味着 D1/D3/D4/D5/D6/D7/D8
   （engine 层）在代码层面没有回归风险，本轮只需要**重新跑测试确认**，重点核验精力
   放在 D2/D9（今天的 DA-19 前端集成可能触及）+ D6（今天新增了一条前端 HITL 通路，
   需要判断是否影响、要不要影响）。
3. 今天（2026-08-24/25）新增的 DA-19a~g 全部改动都在 `apps/web`/`apps/api`
   （CopilotKit v2 前端轨道 + `copilotkit-agui.controller.ts` 桥接层），不在
   `apps/deep-agent-service`。

## 1. 本轮方法论：把新轨道接到真实引擎，不是继续读 loopback 证据

任务描述准确指出上一轮遗留的关键问题：DA-19c/f/g 的验证全部走
`loopback-deep-agent-provider.ts` 替身，从未证明"如果接到真实
`apps/deep-agent-service`，这条新轨道是否真的行"。本轮把这件事做了：

1. 用 `uv run --extra dev langgraph dev --no-browser --port 2024` 起了**真实**
   `apps/deep-agent-service`（真实 `deepagents==0.7.x`、真实 DashScope
   `qwen3.8-max` 模型，`KERNEL_MODEL_BASE_URL`/`KERNEL_MODEL_API_KEY` 复用
   `.env.local` 里 `DASHSCOPE_*` 凭据的同名映射，`model.py` 自己的文档注释
   写明这是设计好的映射关系，不是本会话发明的）。
2. 临时（未提交，已用 `cp` 复原、`git diff --stat` 确认零残留）把
   `apps/web/playwright.chat-read.config.ts` 的 `KERNEL_DEEP_AGENT_BASE_URL`
   从 loopback 替身端口改指向 `http://127.0.0.1:2024`，跑
   `verify:chat-read` 的 chat-read 全套真登录/真 Postgres/真 CopilotRuntime
   编排，唯一替换的是 deep-agent 这一路上游。
3. 额外用 `x-kernel-test-principal` 测试注入头（`KERNEL_ALLOW_TEST_PRINCIPAL=1`，
   fixture 本来就开着）直接对真实 apps/api 进程的
   `POST /copilotkit/agui?agentId=agent-chat-read-e2e-deep` 打 curl，绕开浏览器，
   拿到**真实引擎产生、经真实生产 controller 转译**的原始 SSE 字节
   （`live-copilotkit-agui-real-engine/01-sse-real-engine.txt`）。

## 2. D2 工具调用透明度：0.3 → **0.7**（真实改判，非探针问题）

**证据**：`live-copilotkit-agui-real-engine/01-sse-real-engine.txt`——对真实
`apps/deep-agent-service`（真实模型）发"请调用 list_org_skills 看看现在有哪些
技能可用，然后用 call_skill 执行一个，最后给我总结"，经**生产** `/copilotkit/agui`
桥（`copilotkit-agui.controller.ts`，与 `/api/copilotkit/[[...slug]]/route.ts`
转发的是同一条端点，不是测试专用分支）拿到：

```
RUN_STARTED → CUSTOM(chat_thread_id) → STEP_STARTED(list_org_skills)
→ TOOL_CALL_START → TOOL_CALL_ARGS({}) → TOOL_CALL_END
→ TOOL_CALL_RESULT("本次运行没有挂载任何技能，直接依靠已有知识回答即可。")
→ STEP_FINISHED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT(真实模型总结，
   如实说明"未调用 call_skill：因为没有任何有效的技能名可用，按规则不能凭名字
   编造或虚构执行结果，所以这一步跳过") → TEXT_MESSAGE_END → RUN_FINISHED
```

这直接推翻了上一轮"生产链路从未消费独立工具调用事件"的结论——**现在有一条
生产路由（`/chat/copilotkit-v2` → `/copilotkit/agui`）真的把真实引擎的工具调用
翻译成 6 个独立 AG-UI 事件类型**（`TOOL_CALL_START`/`_ARGS`/`_END`/`_RESULT`
各自独立），前端 DA-19c 的 `useRenderTool`（`copilotkit-v2-tool-renderers.tsx`）
按事件类型分别渲染定制卡片——这一半已经被今天的 `copilotkit-v2-tool-rendering.spec.ts`
（走 loopback）证明过机制本身真的工作，本轮补的是"数据源换成真实引擎，这条机制
仍然产生同样形状、真实的独立事件"这一半。

**为什么不是 1.0**：本轮同时读到 `copilotkit-v2-tool-rendering.spec.ts` 文件头
"已知限制③"——DA-19c 作者自己实测发现并如实登记（未在本任务内修）的真实缺陷：
`writeToolCallStep`（`copilotkit-agui.controller.ts`）对任何 `RunStepPublic`
不分 `status` 一律发送完整的 `START→ARGS→END→RESULT→FINISHED` 序列，其注释
"Every RunStepPublic ... is ALREADY COMPLETE by the time onStep fires" 是
#742 Gap 1（引入真实 `in_progress` 上报）之前的过时前提——一个真正"进行中"的
step 也会被当作终态发出去，`content` 恒为空字符串，`search_documents`/
`read_document` 的结果文本 4/4 次实测稳定复现为空（本会话未重新实测这个具体
子场景，采信 spec 文件头自己的取证记录，因为该记录本身就是"page.route()+
route.fetch() 抓原始 SSE 字节"这种物理证据，不是口头转述）。已登记为独立
issue #2016（本会话新开，不在本次评分 PR 里顺手改代码）。

另一个封顶原因：本轮验证的是**新增的次要路由** `/chat/copilotkit-v2`，
不是默认/主 `/chat` 生产界面——真实终端用户今天默认落地的仍是旧轨道
（`/api/agent-runs` 轮询 + `messages-tuple` stream_mode），这条新轨道即使
完全正确也只覆盖一部分真实流量入口。命中统一标尺 0.7 档"能力真实存在且可用，
但缺关键子项"（子项缺口：状态转换保真度 + 尚未成为默认生产入口）。

## 3. D9 Agent↔UI 双向上下文：0.3 → **0.7**

**下行（不变，沿用既有事实）**：DA-17 的 `STATE_SNAPSHOT`（write_todos 全量
账本）仍是这条轴上唯一真实生产者，本轮 D2 证据包里再次核实过这条通路的机制
未变（今天没有 diff 触及 `writeToolCallStep` 的 STATE_SNAPSHOT 分支）。

**上行（真实改判）**：DA-19f（PR #1983，issue #1982）新增
`useAgentContext`（`copilotkit-v2-providers.tsx` 的
`CopilotKitV2ReadableContextProbe`）——注入固定标记字符串
`DA-19F-READABLE-CONTEXT-PROBE` + 当前 `pathname`。`copilotkit-v2-agent-context.spec.ts`
的取证方法本身是 wire 级的（`page.route()` 拦截 `POST /api/copilotkit/agent/:id/run`，
读**裸请求体字节**、反序列化、断言字段值存在，不是"hook 调用没报错"这种弱证据）。

本会话尝试**独立重跑**这条 spec（含单独接到真实引擎、单独单 worker 重跑两次
尝试）——均因本机资源竞争导致基础设施失败（第一次 3 个测试并发下
`page.goto: net::ERR_ABORTED`；第二次单独跑时 Postgres 容器在启动阶段被
"terminating connection due to administrator command" 杀掉，`uptime` 显示当时
`load1=14.09`／10 核，与今天更早时候另一个 agent 留下的孤儿 docker 栈叠加），
两次都没能拿到本会话自己的一次干净通过。**如实记录：本轮没有拿到属于本会话的、
针对这个具体维度改判的全新 wire 抓包**。

**为什么仍然改判到 0.7，而不是维持 0.3**：
1. 上行注入通路本身与 deep-agent-service 引擎身份（真实/loopback）无关——
   `useAgentContext` 在浏览器侧把值写进 `CopilotRuntime` 的 `ContextStore`，
   这一步发生在请求离开浏览器、到达 `apps/api` 之前，不经过下游引擎；本会话
   两次失败都是基础设施层（网络/DB 连接被杀）问题，从未见过一次"请求体里没有
   注入值"这类**该维度本身**的失败信号。
2. 本会话逐行读过 `copilotkit-v2-agent-context.spec.ts` 与
   `copilotkit-v2-providers.tsx` 的实现——注入机制是 `useAgentContext` →
   `ContextStore.addContext` → `CopilotKitCore._internal...`（官方包内部机制，
   spec 文件头本身有逐层调用链记录），不是前端伪造/轮询包装，符合"引擎/框架
   原生能力"的反伪造判据。
3. DA-19f 是今天 merge 进 main 的既有生产代码（`git log` 可查 `1ef5fe98`/
   `5af8879e`），其 e2e 在合入时按 harness 完成定义（第 2/3 条：verification
   命令执行成功 + 证据写入）已经通过——本会话选择**采信"已合入 main 的既有
   通过证据"这一类事实**（"合入 main"本身是会随状况改变的信号，符合
   `static-trace-vs-live-fact.md` 的判据："merge-base --is-ancestor" 式的
   当前血统事实，不是一份写死不变的痕迹描述），而不是要求每一轮评分都必须
   重新独立采集一次全新抓包才能采信——这与"不采信口头转述"并不矛盾：口头转述
   是"某人说它工作"，而"该 spec 是 CI/合入门控里跑过的真实断言且以此为条件
   合入"是可核验的机械事实。

**为什么不给 1.0**：`useAgentContext` 注入的值是一个**固定标记字符串 + 当前
路由**，不是真正的用户视窗（viewport）、当前选中内容（selection）或随用户
交互变化的客户端变量——命中 rubric 0.7 档"上行静态（仅首次注入）"的精神
（严格说是"每次请求都重新发送，但内容本身与路由绑定、不随用户实时交互变化"，
比"仅首次"宽松一点，但远没有达到 1.0 档"视窗/选中内容/客户端变量实时注入"
要求的动态业务信号），spec 自己的文件头也明确写了范围边界："不断言注入的
探针值影响了 agent 的回复内容"——这条通路目前只证明"通不通"，不是真正的
业务级双向上下文工程。

## 4. D6 人在环：维持 **1.0**（engine 层未回归），但发现新架构缺口（已登记 #2017）

1. **Engine 层无变化**：`git diff --stat 3d327c13..HEAD -- apps/deep-agent-service/`
   为空，`tests/test_harness.py` 的 6 个 HITL 用例本会话重新起临时 Postgres 容器
   （`postgres:16.14-alpine3.22`，验证后 `docker rm -f` 销毁，非常驻）后
   `uv run --extra dev pytest tests/ -q` 47/47 全过（`pytest-run-20260825-full.txt`），
   approve/reject/edit 三态断言（真实副作用计数，不是文本包含检查）逐字未变。
2. **今天新增的 DA-19g CopilotKit 新轨道 HITL（`send_email`/
   `SendEmailApprovalDialog`）是另一层**：本会话把 `copilotkit-v2-hitl.spec.ts`
   接到真实引擎后三个测试全部失败/超时（不是回归——这条能力设计上就只能在
   loopback 替身下运行）。根因：`send_email` 是纯前端 CopilotKit frontend
   action，不是 `apps/deep-agent-service` 图里的真实 Python 工具（该服务
   工具集只有 `list_org_skills`/`call_skill`/`write_todos`，`tools.py` 逐字
   确认）；`copilotkit-agui.controller.ts` 的 `AguiRunInput` 自己的文档写明
   "tools, context, state" 字段被整体忽略——即使浏览器把 `send_email` 的
   schema 放进 `RunAgentInput.tools`，桥接层也不会转发给真实引擎，真实引擎
   从始至终不知道这个工具存在，不可能触发它自己的 `interrupt_on`。
3. **对 D6 打分的影响**：rubric D6 评的是"引擎能力"，真实引擎自己的
   `interrupt_on`+`HumanInTheLoopMiddleware`（配合 `DEEP_AGENT_HITL_TOOLS`
   真实工具名）approve/reject/edit 三态机制本身完好，未受影响，维持 1.0。
   DA-19g 的前端 frontend-tool 审批是产品层新增的**另一种**能力（当前只能
   在 loopback 替身下工作），不计入这个维度的引擎分，但作为架构缺口登记为
   issue #2017，供后续需要"前端自定义敏感动作也走真实引擎审批"时参考。

## 5. D1/D3/D4/D5/D7/D8/D10：**维持不变**，本会话重新验证无回归

- **代码零 diff**（见 §0.2）——所有 engine 层维度理论上不应该变。
- **D1（0.7）**：`TodoListMiddleware` 未变；今天新增的 DA-19c write_todos
  定制卡片（`copilotkit-v2-tool-rendering.spec.ts` test 1）本质上是把已有的
  `STATE_SNAPSHOT` 事件（D9 下行部分）渲染成前端进度卡片——**本会话没有拿到
  一次干净的、针对真实引擎的活体验证**（同 §3 的资源竞争问题，且本轮真实
  引擎探针本身没有促发 `write_todos` 调用，模型判断"没有挂载技能→不需要
  写计划"提前结束）。如实不改判，留给下一轮资源更充裕时补齐这个组合验证，
  不凭代码存在就直接给 1.0。
- **D3（1.0）**：无新证据也无回归依据——engine 代码零 diff，`tests/`
  47/47 通过里包含流式相关用例。
- **D4（0.7）**：`test_interrupt_survives_process_restart_and_resumes` +
  `test_time_travel_rollback_and_fork` 本会话用临时 Postgres 重跑仍 2/2 通过。
- **D5（0.7）**：`test_harness.py -k subagent` 本会话重跑仍全过，`harness.py`
  未变。
- **D7（0.7）**：`test_harness.py -k "retry or budget or loop"` 本会话重跑
  全过，逻辑未变。
- **D8（0.7）**：相关测试本会话重跑全过，`harness.py`/`tools.py` 未变。
- **D10（0.7）**：`tracing.py`/`guided_research_graph.py` 零 diff，
  `test_version_floor_matches_lock`/`test_tracing.py` 本会话重跑全过。
  `guided_research_graph.py` 平行 loop 的治理状态（③ 缺人类对"不迁移"结论
  本身的复核）自 3d327c13 起无新事实，维持同一判定。

## 总分

| 维度 | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | 原始和 | 取整 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 本轮 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 0.7 | 0.7 | 7.6 | **7.5** |
| 上轮 | 0.7 | 0.3 | 1.0 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 0.3 | 0.7 | 6.8 | 6.5 |
| Δ | 0 | **+0.4** | 0 | 0 | 0 | 0 | 0 | 0 | **+0.4** | 0 | +0.8 | **+1.0** |

**净变化 +1.0**（6.5 → 7.5），全部来自 D2 和 D9 两个维度各 +0.4——两者都是
今天（2026-08-24/25）DA-19 系列工作真实推动的上行改判，且都有本轮独立采集
或独立核验过的物理证据支撑（D2 = 本会话对真实引擎的 curl 抓包；D9 = 本会话
对既有合入证据的独立代码级复核 + 两次失败但性质明确无关的复现尝试）。

## 违规检查（反伪造一票否决）

未发现前端轮询/模拟冒充引擎事件流、事后补录 todo、终态一次性打包伪装流式、
未声明的 mock 通路。特别核对：

- D2 的改判证据是本会话**对真实引擎的直接 curl 抓包**，不是对 loopback
  证据的重新解读，也不是采信任务描述里的转述。
- D9 的改判部分依赖"采信已合入 main 的既有 e2e 证据"而非本会话独立全新抓包
  ——如实标注这一点是本轮方法论上的妥协（受机器资源竞争限制），不是把它
  伪装成本会话独立采集的活体证据。
- D6 维持 1.0 是因为**真正被评分的引擎层机制**没有变化，不是因为忽略了
  DA-19g 新轨道 HITL 在真实引擎下完全跑不通这件事——那件事被如实记录、
  登记为独立 issue（#2017），没有被悄悄按下不表。
- D2 的封顶（不给 1.0）依据是 spec 文件头**作者自己**记录的真实缺陷
  （已登记 issue #2016），不是本会话凭空扣分。

## 黄金压测场景 TC-1~TC-5

`apps/deep-agent-service/tests/golden/` 本会话确认仍不存在（DA-09 未交付）。
本轮的真实引擎 curl 探针（`live-copilotkit-agui-real-engine/`）构成 TC-1
（长链综合调研）的一个**弱子集**（1 步工具调用 + 0 次子代理委托，模型如实
判断无技能可调后提前结束，不构成"≥5 步、≥2 次子代理委托"的完整场景）；
TC-2（HITL 修改参数后放行，对真实引擎）本轮**未执行**（`DEEP_AGENT_HITL_TOOLS`
在本会话起服务时未设置，且真实测试所需 `send_email` 场景架构上无法触达真实
引擎，见 §4）；TC-3/TC-4/TC-5 本轮未执行，沿用上一轮"仍未正式脚本化"的结论，
不重复论证。

## 资源清理

- 真实 `apps/deep-agent-service`（PID 18923/18931）已 kill。
- 本会话临时起的 Postgres 容器（`deepagent-rubric-pg`）已 `docker rm -f`。
- 本会话通过 `verify:chat-read` 起的两套隔离栈（`wsx-7d1c8e173a401e0ffadd`/
  `wsx-a73c22150ec8d678ea6c`）已 `docker compose down -v`，进程已确认不再监听
  对应端口。
- `apps/web/playwright.chat-read.config.ts` 的临时改动已用备份文件 `cp` 复原，
  `git diff --stat` 确认零残留。
- `docker ps` 里仍存在一个 `wsx-23bbb19cb315e021f188-postgres-1`——**不是本会话
  启动的**（compose id 与本会话任何一次 `with-test-isolation` 运行输出都不匹配，
  应为更早时间另一个 agent 会话遗留），按"只清自己的"纪律未touch，如实记录
  供后续清理。
