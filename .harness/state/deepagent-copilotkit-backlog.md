# Deep Agent × CopilotKit 十分体验 Backlog

> 创建于 2026-08-22，coord-architecture。目标：agent+chat 体验达到行业顶级 10 分。
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
| S1 | `docs/proposals/PROP-CHAT-COPILOTKIT-LANGGRAPH-001.md` | 编排层范围：☐A 全量替换 AgentRun ☐B 双轨灰度（**推荐 B**：AgentRun 留降级路径，稳定后另议退役） | DA-05 起的全部前端切换 |
| S2 | `.harness/rubrics/deepagent-capability-rubric.md` 文末签名行 | 本评分卡生效 | 全部条目的验收 |
| S3 | 各条目 PR 合并（正常 review 流程） | — | — |
| S4 |（建议）修 F204 签核归属重复 | 解开 pre-push doctor 常红 | 不阻塞本 backlog，但每个 PR 都在被迫 --no-verify |

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

### DA-05 前端切换：生产 /chat 的 agent 会话走 AG-UI 流 ⚠ 需 S1
- **推动**：chat-ux 维度 1/3/9、D2/D3 的用户可见化
- **动作**：装 `@copilotkit/runtime`，Next API route 建 CopilotRuntime + LangGraphHttpAgent；
  `chat-live-message-panel` agent 会话分支从轮询切 AG-UI 订阅。**保留现有气泡/testid/视觉**
  （#728 保真度资产不动），CopilotChat 做 headless 数据源。轮询代码保留为降级路径（S1 选 B 时）。
- **验收**：真实浏览器逐 token 出现；chat-ux 十维重评，维度 1 从当前分升到 1。
- **依赖**：DA-03 + **S1 签署**。

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

### DA-09 harness engineering：PreCompletionChecklist + 反证评测
- **推动**：D7、chat-ux 维度 4（真实多步的质量底）
- **动作**：加 PreCompletionChecklistMiddleware（退出前对照任务自检——LangChain 实测同模型
  +13.7 分那套的核心件）；建一组固定评测任务（多步、含失败注入），CI 可跑，防止引擎回归。
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

## 评分预期（诚实版）

| 条目完成后 | 引擎分预期 | 说明 |
|---|---|---|
| 基线 | 1.5 | 实测 |
| DA-02 | ~4（估） | D1+D4+D8+D10 各升 |
| DA-03/04 | ~5.5（估） | D3 到 1，D9 到 0.5 |
| DA-05/06 | ~7（估） | D2/D9 到 1 |
| DA-07/08/09/11 | ~9+（估） | D5/D6/D7 补齐 |
| **10 分** | 由独立评分 + 人类确认给出 | **不承诺日期承诺机制**：每条做完必重评，最低分维度优先修 |

## 不做的事（明确排除）

- 不动语音输入线（#729 已交付，正交）
- 不删 AgentRun/记账账本（#742 约束：没有留痕就没有调用）
- 不合并三份评分卡（各评各的，合并制造「哪条判据说了算」的漂移）
- 不在 S1 签署前碰生产 /chat 的数据流
