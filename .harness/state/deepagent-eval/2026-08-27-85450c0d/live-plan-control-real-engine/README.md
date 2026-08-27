# 真实登录 + 真实引擎：任务模式手动探针（本轮新增，非自动化 spec）

采集方式：`mcp__Claude_Browser__*` 工具，真实登录 chat-read-e2e 测试账号，
在临时接到真实 `apps/deep-agent-service`（`langgraph dev` 端口 2029，真实
DashScope qwen3.8-max）的 web 进程上手动操作 `/chat/copilotkit-v2`。

## 步骤与观察

1. 新建对话，开启"任务模式（先计划后执行）"，发送真实自然语言多步任务：
   "请帮我制定一份新产品上市的调研计划：先看竞品定价，再看渠道选择，最后给出定价建议。"
2. `POST /api/copilotkit/agent/default/run` 原始 SSE（见 `01-run-sse-raw.txt`）证实：
   - **#2224（提示词修复）本次命中**：真实模型真的调用了 `write_todos`（结构化 3 步
     JSON，而非纯文本"第一步/第二步"），先调了 `list_org_skills`（无挂载 skill，
     如实回答未编造），两个工具调用各自产生独立的
     `TOOL_CALL_START→ARGS→END→RESULT` 事件，`STEP_STARTED/STEP_FINISHED` 包裹。
   - `STATE_SNAPSHOT` 带着 3 条 todo 下行，前端"计划面板"实时渲染出 3 步待办
     （非事后补录——发生在 assistant 文本回复完成之前，snapshot 先行）。
   - `TEXT_MESSAGE_CONTENT` 逐词/短语级 delta 流出（与既有 D3=1.0 结论一致）。
3. 六态面板（`准备/计划/执行/审批/完成`）真实渲染且随对话推进变化——本轮 F972-F978
   接线后首次拿到"真实引擎 write_todos → 六态面板"组合的活体证据（上一轮 7.5 分
   评分因资源竞争未能拿到，本轮资源竞争同样存在但改用直接浏览器操作绕开了
   Playwright webServer 编排层，规避了那个具体瓶颈）。
4. **新发现的缺口**：点击"确认并执行"后，`POST /plan-control/threads/:id/confirm`
   （201）把账本 `phase` 翻到 `"executing"`，前端六态指示器与"当前步骤 1/3 · 已用
   Ns"计时器随之显示——但 `read_network_requests` 全程监听未见任何新的
   `/api/copilotkit/agent/default/run`（或任何调用真实 deep-agent-service 的）请求
   被发出；`GET .../ledger` 反复轮询 40+ 秒后，三个步骤的 `status` 全部仍是
   `"pending"`（见 `02-ledger-after-confirm.json`），`progress.completed` 恒为 0。
   即：**"确认执行"只翻转了账本状态与前端计时器，没有真正触发引擎去执行任何一步**。
   这不是前端伪造 TOOL_CALL 事件（不违反反伪造条款的字面定义），但六态面板呈现的
   "正在执行"观感与后端实际情况（零真实工作发生）不符，是 D1 判分不能给满分的
   直接依据，已按 rubric 纪律另开 issue 登记（见 PR 描述）。

## 与 rubric D1 判据的对应

- 满足「多步任务先产生结构化 todo（工具调用产生，非文本装饰）」✅（本轮新增活体证据）
- 满足「前端实时可见」✅（六态面板+计划面板首次拿到活体证据）
- **不满足**「执行中逐项更新状态」——"执行"阶段是账本层面的状态翻转，没有对应的
  真实引擎工作在推进，逐项状态永远停在 pending。
⇒ 仍落在 0.7 档（"结构化 todos 产生且更新，但…更新粒度粗"——本轮把"粗"坐实为
"执行阶段完全不更新"），但证据基础从上一轮的"resource contention 无法验证"
变为"验证到位、发现具体缺口"。
