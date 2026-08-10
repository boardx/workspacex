# Chat 体验 10 轮迭代开发计划（PROP-CHAT-10ITER-001）

> **状态：计划，逐轮执行中。** 人类 2026-08-11 指令：未来 6 小时自主开发，对比 UI 原型
> 迭代 10 次，每次一个真实改进，必须覆盖 SSE / loading / thinking / 文件上传等体验，
> 并做完整上下文管理 + 深入研究 context engine。本文件是那 10 版的开发计划与执行台账。
>
> 权威判据不在这里：行为看 `.harness/instructions/chat-ux-acceptance-criteria.md`（十项），
> 视觉看 `.harness/rubrics/chat-main-fidelity-rubric.md`。本文件只排序、切分、记录执行。

## 勘探基准（两份独立 codebase-researcher，实测 origin/main `5da21fce`）

### 现状硬事实（决定改哪、不改哪）
1. **活路由 = `apps/web/components/chat/chat-live-message-panel.tsx`（1029 行，强热点，逼近 2000 上限）。**
   `/chat` 只渲染 `ChatReadScreen`（项目）+ `PersonalChatScreen`（个人），两者消息区都下沉到这一个文件。
   原型里保真度高的富组件（`chat-main.tsx`/`message-stream.tsx`/`ai-message.tsx`/`composer.tsx`）
   是**吃 mock 假数据、不在活路由上**的旧签核原型屏——**改进一律不许改到 mock 文件**。
2. **SSE 管道齐全但默认关**：`lib/agent-run-stream.ts` + `agent-run.controller.ts:80-148` 都在，
   但 `KERNEL_MODEL_STREAM_ENABLED` 默认关时退化为纯轮询，用户看不到逐字。
3. **后端上下文组装极简**：`execute-run.ts:167 executeClaimed` = system(instructions+skills) + 历史
   （20 条 / 12000 **字符**预算，从最旧整条丢弃，**无摘要、无 token 真值、无记忆、无检索**）。
4. **仓库里有一整套未接线的 context engine**：`application/context-pack/*` + `application/retrieval/*`
   （五路召回 RRF）+ `docs/architecture/context-engine.md`（2026-07-28 定稿），有 domain/测试，
   **但无 HTTP 端点、无 agent-run 集成**，服务的是 Studio(uc-0-2) 不是 chat。
5. **chat 完全不能上传文件**：`chat_messages` 无附件列、composer 无上传 UI、无注入路径。
6. **两处悬顶热点**：#775（CopilotKit+LangGraph 全量替换 chat 编排层，`docs/proposals/
   PROP-CHAT-COPILOTKIT-LANGGRAPH-001.md`，未执行）若被采纳会重写整条消息/流式路径；
   #728（chat 主屏保真，在途）涉及身份行/输入区。**动 execute-run.ts / 身份行区域需串行化。**

### 执行纪律（本轮全程适用）
- **一次一个 issue 一个 PR**，串行合并（热点文件不能并行踩）。
- **绝不假 UI**：没有真实后端数据支撑的能力，要么不做，要么显式标「未接入」（`NoBackendNotice` 风格）。
- **绝不自评分数、绝不自己改判据/签核 status**（人类动作）。行为改进的验证走本地真栈 e2e
  （`shots:chat-main` / `verify:chat-read`），需要独立评分时派 rev-uiux / rev-e2e。
- **需要契约变更或 design-signoff 的**：设计 + 实现可安全落地的部分 + 备好待签处，裁决问 coord-main，
  签核等人类。不为了推进而伪造签核。

## 10 版排序（no-signoff 优先 · 价值优先 · 碰撞最小优先）

| 版本 | 改进 | 覆盖判据 | 需签核/契约? | 碰撞面 |
|---|---|---|---|---|
| **V1** | 消息区**自动跟随到底**（新消息/流式 token 到达时滚到底，用户在底部时才跟随、上滚时不打断） | 验收#9 控制感 | 否（纯前端） | 低 |
| **V2** | **⌘↵ / Ctrl+↵ 发送**，Enter 换行语义明确，发送中禁用 | 对标 Claude Code 键盘 | 否（纯前端） | 低 |
| **V3** | **逐条消息复制按钮**（hover 出现，复制纯文本，复制态反馈） | 验收#8 呈现质量 | 否（纯前端） | 低 |
| **V4** | **加载骨架屏**替换四处灰字（线程列表 / 线程详情 / 消息首载 / 发送等待） | 验收#9 控制感 | 否（纯前端） | 低 |
| **V5** | **流式逐字兜底**：流式关闭时也给渐进反馈；开启时确保 token 逐个渲染 + 生成进度提示 | 验收#1 流式 | 否（前端 + 读现有 delta） | 中（热点） |
| **V6** | **Thinking 折叠块**「思考了 X 秒 · N 步」，从 `agent_run_steps` 时间戳/步数真实派生（不伪造） | 验收#2 规划步骤 / D6 | 视派生方式（优先纯前端派生） | 中（热点） |
| **V7** | **工具调用富化**：命中/复用/token 计数（若后端有真值），无真值不显示（不编） | 验收#3 工具可见 / D6 | 可能需 step 字段（契约）→ 备签 | 中（热点+后端） |
| **V8** | **context engine 第一步（契约无关的真改进）**：历史预算从「整条丢弃」升级为**滚动摘要**（旧轮压缩成摘要保留要点）+ **token 估算**替代纯字符预算 | 验收#6 多轮上下文 | 否（限 execute-run.ts，需与 #740/#775 串行）→ 问 coord-main | 高（execute-run 热点） |
| **V9** | **文件上传 / 附件**：消息级附件模型 + 上传端点 + composer 上传 UI + 注入 `ModelCallInput` | 原型附件区 | **是**（chat_messages 新列 + 契约 + 端点 + signoff）→ 设计+备签 | 高 |
| **V10** | **context engine 深入：把已有 context-pack/retrieval 引擎接进 chat** 的设计与可落地骨架 | 验收#6 / 产品知识注入 | **是**（跨域接线 + 契约 + signoff）→ 设计+备签 | 高（execute-run + 契约） |

> V1–V6 是本轮能真正合入 main 的主体（纯前端 / 契约无关）。V7–V10 逐步进入需要契约变更/签核
> 的深水区：这些版本我会**做完设计 + 落地不需签核的部分 + 把待签处准备好**，裁决问 coord-main，
> 签核留人类。宁可 V9/V10 停在「设计 + 骨架 + 待签」，也不伪造签核或做假 UI。

## 执行台账（逐轮回填）

| 版本 | issue | PR | 状态 | 证据 |
|---|---|---|---|---|
| V1 | — | — | 进行中 | — |
| V2–V10 | — | — | 待办 | — |

## 需要 coord-main 裁决的（夜间路由）
1. **#775 采纳与否**：若 CopilotKit+LangGraph 全量替换 chat 编排层会被采纳，V5–V10 里动
   `chat-live-message-panel.tsx` / `execute-run.ts` 的改进属于会被重写的投入。请裁决 #775 状态，
   或明确「先按现架构改进、#775 是更远的事」。
2. **V8 动 execute-run.ts 的串行窗口**：该文件是 #740/#742/#775/#728 的共同热点，V8 的滚动摘要/token
   预算改动需要一个不与在途改动撞的串行窗口，请协调切分。
3. **V9 附件契约 + V10 context-pack 接线契约**：都要 design-signoff（人类），我会备好待签处。

## ASR 遗留（不在这 10 版内，单独挂）
devapp 上换 `KERNEL_ASR_MODEL=qwen-audio-3.0-asr-flash-streaming`（实验 A）实测失败：麦克风报
「语音识别服务暂时不可用」。回退是人类在 devapp 上的动作（`cp deploy.env.bak-asr` + redeploy）。
代码侧我留一个诊断任务：需要真实上游日志（`journalctl -u workspacex-api`）里的拒绝原因才能定位
是模型名不被 `?model=` 接受、还是协议形状不同——不猜（#802 前科）。
