# Deep Agent 能力评分卡（对标行业顶级，10 分制）

> 单一事实源：这份文件是「**agent 引擎/编排能力**是否达到行业顶级」的唯一权威判据。
> v2（2026-08-22）：按人类 15 条改进意见修订——统一 4 级标尺、黄金压测场景、
> 反伪造一票否决、物理证据闭环。**待人类签署后生效**（签署方式见文末）。
>
> ## 与既有两份评分卡的边界（三件事，不重复）
>
> | 评分卡 | 评什么 | 一句话 |
> |---|---|---|
> | `chat-main-fidelity-rubric.md` | `/chat` 视觉/结构保真度 | 长得像不像原型 |
> | `chat-ux-acceptance-criteria.md` | chat 端到端行为体验 | 用起来像不像 Claude Code |
> | **本文件** | **agent 引擎/编排能力** | **引擎本身是不是行业顶级的 deep agent** |
>
> 一个维度只允许出现在一份评分卡里——发现重叠，以先存在的那份为准并回来修这里。

## 对标对象（「行业顶级」的定义，可证伪）

以下产品 2026-08 的公开能力为 10 分锚点，逐维度取最强者：
- **Claude Code**（多步执行、工具透明、planning、subagent）
- **深度研究类**（OpenAI/Gemini Deep Research：长任务、进度可见、可中断）
- **deepagents-cli 参考实现**（LangChain 官方 harness，Terminal Bench 2.0 66.5%）
- **CopilotKit 官方 demo**（AG-UI 全事件流 + generative UI）

## 统一分值标尺（全部维度通用，不再各自定义）

| 分值 | 含义 |
|---|---|
| **1.0** | 顶级原生：引擎原生能力，达到对标锚点水平 |
| **0.7** | 进阶达标：能力真实存在且可用，但缺关键子项 |
| **0.3** | 基础雏形/降级：形态存在但本质是降级实现 |
| **0.0** | 完全缺失 |

总分 = 十维之和，向下取整到 0.5。

## ⚠ 反伪造一票否决（凌驾于所有维度之上）

凡以下列方式冒充引擎原生能力者，**该维度直接判 0 并记入违规记录**（评分史备注列）：
- 前端轮询/前端模拟冒充引擎事件流
- 事后补录 todo / 伪造流式（终态一次性打包重放）
- 硬编码数据、mock 通路在评测中未声明
本仓已九次「全绿但空转」，评分卡自己不能成为第十次。

## 十个维度

### D1 规划可见性（planning）
- **1.0**：多步任务先产生结构化 todo（工具调用产生，非文本装饰），执行中逐项更新状态，前端实时可见。
- **0.7**：结构化 todos 产生且更新，但前端不可见或更新粒度粗。
- **0.3**：有计划文本但非结构化状态。
- 锚点：deepagents `TodoListMiddleware` + AG-UI 状态流。

### D2 工具调用透明度
- **1.0**：每次调用的名称/参数摘要/状态/结果作为**独立事件**流出，前端逐个渲染。
- **0.7**：事件流真实但前端只渲染部分字段。
- **0.3**：事后可见完整调用记录，过程中不可见。

### D3 真流式（token 级）
- **1.0**：模型 token 逐 delta 流出，事件时间戳证明逐步。
- **0.7**：句/段级分块流出。
- **0.3**：协议是 SSE 但内容为终态一次性打包（**当前 agui-bridge 形状**）。

### D4 持久化与时间旅行
- **1.0**：**节点级** checkpointer 持久化（Postgres），支持：跨会话/重启恢复、
  按 checkpoint_id 回溯到任意历史节点、从历史节点分支探索（time travel / rollback）。
- **0.7**：持久化 + 重启恢复，但无回溯/分支。
- **0.3**：进程内记忆（MemorySaver / 平台内存态），重启即失。

### D5 子代理委托（subagent）
- **1.0**：主 agent 可派子任务给隔离上下文 subagent，前端可见委托发生、子代理归属与归并。
- **0.7**：委托真实但前端不可见。
- **0.3**：有 `task` 工具但从未真实触发（守着空气）。

### D6 人在环（HITL）
- **1.0**：敏感工具调用前暂停待批（`interrupt_on`），批准/拒绝/**在线修改参数后放行**三态都通。
- **0.7**：批准/拒绝两态。
- **0.3**：只能全停或全放。

### D7 错误恢复、死循环检测与预算熔断
- **1.0**：① 失败逐条以错误事件流出并渲染；agent 对失败重试或改道，不编造成功。
  ② **死循环检测**：同一工具/文件重复操作超阈值时注入纠偏（LoopDetection 等价）。
  ③ **预算熔断**：最大步数/Token/时间三种预算至少两种强制生效，超限时安全降级并**明确通告用户**，不是静默截断。
- **0.7**：①达标，②③缺其一。
- **0.3**：失败可见但无恢复、无熔断。

### D8 上下文工程（context engineering）
- **1.0**：① 长对话**滚动语义摘要**（SummarizationMiddleware 等价，非粗暴截断）；
  ② 大结果自动卸载：单个工具输出超过阈值（默认 4KB，可在配置声明并存证）强制落盘为
  虚拟文件并以引用 URI 注入，正文只留摘要；
  ③ 静态段 prompt cache 真实命中（以 API 响应的 cache 命中字段为证，非配置存在即算）。
- **0.7**：三项达其二。
- **0.3**：只有截断。

### D9 Agent ↔ UI 双向上下文（state sync + context injection）
- **1.0**：**双向**。下行：agent 状态（todos/files/自定义字段）以 STATE_SNAPSHOT/DELTA
  实时同步前端。上行：前端将用户**视窗（viewport）、当前选中内容（selection）、
  客户端变量**实时注入为 agent 推理上下文（useCopilotReadable 等价），并可在请求中验证注入生效。
- **0.7**：下行实时 + 上行静态（仅首次注入）。
- **0.3**：单向、终态同步。

### D10 架构纯度与可观测性
- **1.0**：① 标准框架 API 遵从：无废弃接口调用，依赖地板与 lock 的 major.minor 一致且有 CI 门；
  ② 中间件解耦：能力以官方 middleware 口径组合，无绕过框架的私有 hack；
  ③ **无未裁决的平行 loop**（平行者须有签核的存在理由）；
  ④ 分布式调用链可观测：LangSmith trace 或 OpenTelemetry 可导出，评测时能拿出 trace ID。
- **0.7**：①②达标，③或④缺。
- **0.3**：版本新但用法停在旧 API（**当前形状**），或平行 loop 无裁决。

## 黄金压测场景（TC-1 ~ TC-5，评分的客观化基础）

每次正式评分**必须**跑完五个场景，逐场景归档证据。杜绝主观打分漂移：
维度分必须能指向至少一个 TC 场景的实测输出。

| # | 场景 | 主要检验维度 |
|---|---|---|
| **TC-1** | 长链综合调研：一个需要 ≥5 步、≥2 次子代理委托的调研任务 | D1 D2 D3 D5 |
| **TC-2** | 高危操作：触发一个配置为 interrupt 的敏感技能，走「修改参数后放行」路径 | D6 D2 |
| **TC-3** | 连续故障注入：让一个工具连续失败 3 次 + 构造一个会循环的任务，验证自愈/熔断/通告 | D7 |
| **TC-4** | 30 轮超长上下文：第 30 轮追问第 2 轮的细节，验证摘要质量与条件召回 | D8 D4 |
| **TC-5** | 断点恢复：任务执行中途 kill 服务进程，重启后从 checkpoint 续跑并回溯一次历史节点 | D4 D7 |

场景脚本落在 `apps/deep-agent-service/tests/golden/`（DA-09 交付），CI 可跑其自动化子集。

**2026-08-25（issue #2051）：五条脚本已交付**，此前三轮评分（5.0 / 6.5 / 7.5）记录里
「TC 脚本目录不存在」的缺口到此为止。评分时照这两条走：

- 一键跑完五条并产出逐场景证据：`bash apps/deep-agent-service/scripts/verify-golden-scenarios.sh`
  （自动起一次性 Postgres 给 TC-5，退出即销毁）。证据落在
  `apps/deep-agent-service/.golden-evidence/<utc>/`，整目录拷进本次评分的证据目录即可。
  CI 上同一套跑在 `.github/workflows/deep-agent-tests.yml`（带 Postgres service container）。
- ⚠ **自动化子集的边界必须一并读**：`apps/deep-agent-service/tests/golden/README.md`
  的分级表逐条写明了每个 TC **不覆盖**什么。五条全部用脚本化假模型，证明的是
  **引擎行为**；凡本文件里写着「前端可见 / 前端逐个渲染」的档位（D1 D2 D9），
  以及需要判断模型输出质量的部分（D3 token 流、D8 摘要质量、D7「不编造成功」），
  **不得**用这些脚本的绿灯顶替，仍须另取活体证据。拿 TC 绿灯充当前端证据，
  属于本文件「反伪造一票否决」条款下的冒充。

## 物理证据闭环（每次评分强制归档）

评分史每行必须附证据目录（`.harness/state/deepagent-eval/<date>-<sha>/`），至少包含：
1. **SSE 原始事件流**（curl 落盘或浏览器 HAR）——判 D2/D3/D9 的唯一凭据
2. **Checkpointer 数据库快照**（相关线程的 checkpoint 行导出）——判 D4
3. **Trace 链路**（LangSmith trace ID 列表或 OTel 导出文件）——判 D10④
4. TC-1~TC-5 逐场景的执行记录与结论

没有证据目录的评分行无效——「没有证据 = 没有完成」（AGENTS.md 完成定义）。

## 评分流程

1. 实现者**不自评**。独立会话按本文件跑 TC-1~5 逐维实测。
2. 评分行 append 到评分史：日期、SHA、十维、总分、证据目录、违规备注。
3. 任一维度降分必须开 issue 说明回归。
4. 「10 分」须人类最终确认。

## 评分史（append-only，最新在上）

| 日期 | SHA | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | 总分 | 证据 | 违规 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-25 | 7d2802b1 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 0.7 | 0.7 | **7.5** | `.harness/state/deepagent-eval/2026-08-25-7d2802b1/`（`live-copilotkit-agui-real-engine/01-sse-real-engine.txt` = 本会话把 `/chat/copilotkit-v2` → `/copilotkit/agui` 生产桥接到**真实** `apps/deep-agent-service`（真实 `langgraph dev` + 真实 DashScope 模型，非 loopback 替身）后直接 curl 抓到的原始 SSE，独立 `TOOL_CALL_START/ARGS/END/RESULT` 事件；`pytest-run-20260825-full.txt` = engine 层 47/47 用例本会话重跑确认无回归；`scoring-rationale.md` = 十维逐条依据 + 与上轮 6.5 的 delta 说明） | ① D2 从 0.3→0.7：今天新增的 `/chat/copilotkit-v2` 生产路由首次把真实引擎的独立工具调用事件转译并渲染，但 `copilotkit-v2-tool-rendering.spec.ts` 文件头自证的"已知限制③"（`writeToolCallStep` 对 in_progress 步骤误发已完成空结果）封顶不给 1.0，已登记 issue #2016。② D9 从 0.3→0.7：DA-19f `useAgentContext` 上行注入通路本会话代码级复核为真、且是已合入 main 的既有 wire 级 e2e 证据，但本会话两次独立重跑该 spec 均因机器资源竞争（load1 一度 14+，另一 agent 遗留孤儿栈叠加）在基础设施层失败，未拿到本会话独立采集的全新抓包，如实记录为方法论妥协而非全新活体证据。③ D6 维持 1.0：真实引擎 HITL 机制未变仍 47/47 通过，但今天新增的 CopilotKit 新轨道 `send_email` 前端 HITL 架构上完全无法触达真实引擎（`AguiRunInput` 丢弃 `tools` 字段），已登记 issue #2017，不影响本维度分数。④ D1 未随 DA-19c write_todos 卡片改判：本会话未能拿到"真实引擎 write_todos 调用 + 该卡片渲染"组合的干净活体证据（同②的资源竞争问题），保守维持 0.7，不凭代码存在直接给 1.0。⑤ TC-1~TC-5 黄金压测脚本目录仍不存在（DA-09 未交付）；本轮真实引擎探针仅构成 TC-1 的弱子集（1 工具调用、0 子代理委托）；TC-2 本轮因 `DEEP_AGENT_HITL_TOOLS` 未配置且 `send_email` 场景架构上不可达而未执行；TC-3/4/5 未执行。 |
| 2026-08-23 | 3d327c13 | 0.7 | 0.3 | 1.0 | 0.7 | 0.7 | 1.0 | 0.7 | 0.7 | 0.3 | 0.7 | **6.5** | `.harness/state/deepagent-eval/2026-08-23-3d327c13/`（`sse-and-thread-state-evidence-v2/` = 探针修好后重采的活体 SSE，90 条 messages + 22 条 updates；`delta-and-tool-event-extraction.txt` = 本会话对该证据包的逐条解析；`frontend-wiring-notes.md` = Explore 子代理核实的生产前端 stream_mode 消费情况；`pytest-run-20260823.txt` = 本会话全量+HITL+tracing 子集重跑记录；`scoring-rationale.md` = 十维逐条依据 + 与上轮 5.0 的 delta 说明） | ① D2 上一轮"engine 无独立工具调用事件"的判据本身是探针坏掉导致的假象，engine 层其实原生具备，但生产 `apps/api` 从未请求 `updates` stream_mode 去使用它，最终用户体验仍是事后完整记录，分数不变但依据整体改写。② D10③ `guided_research_graph.py` 平行 loop 仍未给满分：#1889 的"不迁移"结论是 agent 在人类预授权的核对流程内下的技术判断，缺人类对这个反向结论本身的显式复核，保守判未完全达标。③ TC-1~TC-5 黄金压测脚本目录仍不存在（DA-09 未交付），未临时补写脚本凑数。④ Checkpointer 数据库快照本轮未重新采集（沿用上轮机制、本会话仅用临时 Postgres 容器重跑测试复核，未重新导出 checkpoint 行）。 |
| 2026-08-23 | 6f84375c | 0.7 | 0.3 | 0.3 | 0.7 | 0.7 | 0.3 | 0.7 | 0.7 | 0.3 | 0.3 | **5.0** | `.harness/state/deepagent-eval/2026-08-23-6f84375c/`（`sse-and-thread-state-evidence/` = 活体 SSE/thread-state/checkpoint-history/fault-injection 采集；`postgres-supplement/` = 本次评分会话补采的真 Postgres 时间旅行/HITL 跨进程恢复验证 + checkpoint 行导出；`scoring-rationale.md` = 十维逐条依据） | ① D10④ trace 链路缺失：证据 `00-info.json` 显示 `langsmith:false`，全仓无 OTel 导出，评测时拿不出 trace ID，D10④ 判未达标，是 D10 停在 0.3 而非 0.7 的主因之一。② D10③ `guided_research_graph.py` 平行 loop：人类已于同日裁决「迁移到 deepagents 统一引擎」但尚未派工执行，现状仍是未收口的双图。③ TC-1~TC-5 黄金压测脚本目录 `apps/deep-agent-service/tests/golden/` 不存在（DA-09 未交付），本次评分未临时补写脚本凑数，如实记录为缺口而非违规。④ D6 只验证了 approve 一态，reject/在线改参数两态无任何测试或活体证据。⑤ D7② 死循环纠偏是总调用次数硬顶（近似），非同工具/文件重复检测的严格等价物。 |
| 2026-08-22 | 314a6561 | 0 | 0.3 | 0.3 | 0.3 | 0 | 0 | 0.3 | 0 | 0 | 0.3 | **1.5** | 基线，backlog §基线取证（v2 标尺重评：D4 平台内存态 0.5→0.3、D10 旧 API 用法 0.5→0.3、D7 失败可见无恢复 0.3；总分不变） | — |

> 基线注：引擎能力分与 chat-ux P 组 7/10 不矛盾——那 7 分里相当部分是前端在轮询架构上
> 手工逼近的体验。按 v2 反伪造条款，其中「前端逼近」的部分**不得**计入引擎分。

## 人类签署

- 签署人：usamshen
- 日期：2026-08-22
- 裁决：☑ 按本文件生效
