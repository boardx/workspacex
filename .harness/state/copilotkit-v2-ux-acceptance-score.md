# `/chat/copilotkit-v2` UX 验收评分记录（DA-19g 评分循环）

> 权威判据：`.harness/instructions/chat-ux-acceptance-criteria.md`。
> 本文件是"新轨道 `/chat/copilotkit-v2` 十项打分"这件事的记录，不是判据本身——判据改动
> 只在上面那份文件里发生。

## 第 1 轮（覆盖 `e28b042c`）

> ⚠ 本节内容是第 2 轮评分执行者从协调者（coord-main）交办任务时给出的书面摘要**转述**
> 重建的——第 1 轮执行者当时未把这份状态文件提交进仓库（`git log --all` 对本文件路径
> 无任何历史，含所有 worktree），协调者转述的分项理由本身应视为可信来源，但逐条证据
> 截图/命令输出已经随第 1 轮的临时 worktree 一起清理、无法在本仓库内复核。第 2 轮起
> 本文件正式提交进 main，后续轮次不应再出现"评了分但没留痕"的情况。

- **总分：5.0 / 10**
- 最低三项：
  - 第 5 项 语音输入体验：**0 分**——`grep -rni "mic|voice|audio|asr"` 在 `/chat/copilotkit-v2`
    相关组件零命中，麦克风入口完全不存在。
  - 第 10 项 整体连贯性：**0.2 分**——HITL（`SendEmailApprovalDialog`）终态弹窗遮罩永久
    锁死 DOM，用户点击"发送"等交互被遮罩拦截指针事件，唯一解法是刷新页面。
  - 第 6 项 多轮上下文：**0.3 分**——`copilotkit-v2-panel.tsx` 从未回传
    `forwardedProps.chatThreadId`，每轮 `runAgent` 调用都在替身侧开新线程，"重试一下"
    "还记得我上一句说的吗"这类追问拿不到真实历史。
  - 第 8 项 消息呈现质量：**0.3 分**——markdown 触发词从未命中（怀疑与第 6 项同一个
    "传输层没把正确的最新用户消息送到替身"根因），代码块/标题/引用块渲染路径未被
    真实验证过。
- 其余各项分数未在协调者转述中逐条给出，第 2 轮不重建、只在下面按"对照复核"方式逐条
  重新实测并给出完整分数。

## 第 2 轮（覆盖 `1bf25a75`）

- **评分日期**：2026-08-25
- **实测 SHA**：`1bf25a75cf6880e617641cae2e2403100a93fa09`（`origin/main`，四个待复核 PR
  #2000/#1999/#2004/#1995 均已在血统内，`git merge-base --is-ancestor` 未单独跑，
  但四条 `git log --oneline` 记录均在这条 SHA 的直接祖先链上）。
- **方法**：独立隔离 worktree（`/private/tmp/.../scratchpad/wt-da19g-round2`，未碰共享
  主目录），跑 `pnpm run verify:chat-read`（`playwright.chat-read.config.ts`，真实
  Chromium + 真 Postgres/Redis + 真 API + Next dev + 确定性 deep-agent/ASR loopback
  替身），覆盖全部 8 个 `copilotkit-v2-*.spec.ts` 文件。**不是只读代码 diff**——
  对两个可疑结果（markdown/mermaid、多轮上下文）额外用 `--workers=1` 单进程重跑，
  排除"5-worker 并行导致的 race condition"这个假设后确认是真实、确定性可复现的失败，
  不是测试基础设施噪音。语音输入 spec 在全量跑里被 Playwright 记成"did not run"
  （worker 因其他测试失败而提前收尾，不是它自己的问题），单独隔离重跑后确认真实通过。

### 逐项分数

1. **流式反馈：0.6**（相对第 1 轮：证据加强，非本轮直接改动目标）
   `copilotkit-v2-runtime-adapter.spec.ts` test 1 直接解析 wire 上的原始 SSE
   `TEXT_MESSAGE_CONTENT` 帧，证明后端确实分片下发（不是攒完一次性吐出）；
   `playwright.chat-read.config.ts` 显式开着 `KERNEL_DEEP_AGENT_STREAM_ENABLED=1`，
   头注写着"评分员 2026-08-23 的判 0 依据是『相邻帧正文字数相同』，这行 + loopback
   的 stream 端点让那个判据在取证环境可以翻正"——即该项此前被判过 0 分，已有专门
   修复动作，但本轮只做到"wire 级证据确认存在分片"，没有对 `/chat/copilotkit-v2`
   UI 侧做逐帧渲染时序的独立肉眼/像素级复核，不打满分。
2. **可见的规划步骤：0.8**（与第 1 轮相比：本轮首次给出实测证据，此前未逐条打分）
   `copilotkit-agui-state-snapshot.spec.ts`（STATE_SNAPSHOT 驱动 `AgentPlanPanel`）
   与 `copilotkit-v2-tool-rendering.spec.ts` 的 `write_todos` 定制卡片均真实通过：
   agent 在调用 `lookup_time` 工具前，先渲染出"理解用户问题→组织最终回答"这类计划
   条目，用户能看到执行前的意图说明。
3. **可见的工具调用与进度：0.7**
   `write_todos`/`search_documents` 两张定制卡片都真实渲染出参数摘要与状态机
   （进行中/已完成两态），`copilotkit-v2-tool-rendering.spec.ts` 两条测试真实通过。
   未打满分：`search_documents` 卡片的最终结果文本断言仍受文件头注"已知限制③"
   限制（不强断言结果文本内容）。
4. **真实的多步能力：0.3**（与第 1 轮口径一致，未变）
   loopback 替身是确定性剧本，非真实模型推理——`chat-ux-acceptance-criteria.md`
   已知结构性限制段落本就承认这一点，本轮未改变这个事实，也不是本轮四个 PR 的目标。
5. **语音输入体验：1.0**（相对第 1 轮 0 分：**确认修好**）
   `copilotkit-v2-voice-input.spec.ts` 独立隔离重跑真实通过（20.6s）：真实
   `getUserMedia`（假音频源，不是打桩）→ 点击麦克风 → `chat-mic-listening`
   可见 → **录音仍在进行时**输入框已经出现转录文字（不是停止后才整体回填，
   `expect.poll` 断言过录音中期即已包含前缀）→ 停止后文字仍在、可编辑（追加一段
   人工文字）→ 发送后编辑后的完整文本出现在消息记录里。四步证据链完整，麦克风
   入口此前"完全不存在"的问题已消失。
6. **多轮上下文：0.2**（相对第 1 轮 0.3 分：**如实记录——PR #2004 声称修复，
   但独立复核显示端到端行为仍未达标，比第 1 轮的诊断更精确但结论未变好**）
   `copilotkit-v2-runtime-adapter.spec.ts` 新增的 DA-19g 回归测试
   （"第二轮回复真的引用第一轮的用户原文"）本轮两次独立运行**均确定性失败**
   （全量 5-worker 一次 + `--workers=1` 单进程重跑一次，结果逐字节相同，排除了
   并行竞态这个解释）：连续发两条消息，第二条命中 `deepAgentFollowupContextTrigger`
   （"取证：还记得我上一句说的是什么吗"），预期回复带 `[remembered:]` 前缀并引用
   第一轮原文"ZEBRA-4471"，实际拿到的仍是通用回显模板（`根据查询结果回答你："..."
   —— 已查询当前时间...`），完全没有 `[remembered:]` 前缀——`loopback-deep-agent-
   provider.ts` 里 `FOLLOWUP_CONTEXT_TRIGGER` 分支从未被命中。UI 侧确实能在同一个
   消息列表里看到两轮对话（客户端历史渲染正常），但**服务端并未真的按"记得上一轮"
   的语义作答**，判据要求的"重试/追问不需要用户重新提供背景"这件事没有被验证成立。
   本轮未能定位确切根因（怀疑与同一面板并发触发的 `useConfigureSuggestions`
   后台请求共享同一个 `runs`/`conversationLog` 服务端 Map、可能存在覆盖写入的
   竞态，但未证实，留给下一轮排查），登记为**新发现的具体诊断线索**，不只是
   "还是老样子"的重复描述。
7. **错误处理透明度：0.5**（与第 1 轮相比：未见退步，也未做独立验证升级）
   `copilotkit-v2-runtime-adapter.spec.ts` 的"清空 token 后必须失败"用例本轮跑
   报了失败，但检查失败堆栈后判定是 Playwright 已知的"上一个测试的 `route.fetch()`
   仍在飞行中，异步清理噪音污染下一条用例报告"这类基础设施伪影（与
   `copilotkit-v2-agent-context.spec.ts` 头注记录的同一类问题同源特征），不是这条
   用例自身的断言逻辑失败——但本轮没有时间把这条用例单独隔离重跑到绿来实锤，
   所以不据此上调分数，只如实说明这不是新增的功能性回归。
8. **消息呈现质量：0.3**（相对第 1 轮 0.3 分：**如实记录——仍是老样子，PR #2004
   没有顺带修好**）
   `copilotkit-v2-runtime-adapter.spec.ts` 的 "DA-19b markdown/mermaid 消息渲染"
   回归测试本轮两次独立运行（全量 + `--workers=1` 单进程）均确定性失败：
   `chat-ai-markdown` 容器下始终找不到 `<h2>` 节点（30s 超时），说明触发词命中后
   assistant 正文要么没有被正确解析成结构化 DOM，要么根本没有到达客户端——与第 1
   轮报告怀疑的"与第 6 项同一个传输层 bug"这个猜测方向一致：本轮两个失败点
   （markdown 触发词、多轮上下文触发词）都表现为"loopback replies 的特殊分支
   没有被命中/没有被正确渲染"，指向同一类"上行消息内容在到达替身或到达客户端之前
   被改写/丢失"的根因家族，值得下一轮合并排查。
9. **控制感：0.7**
   `write_todos` 进行中/完成两态卡片 + `ActiveFilePanel`（`file_created`/
   `file_content_delta` 真实驱动右栏渲染，`copilotkit-v2-active-file-panel.spec.ts`
   两条测试都通过，含"没有事件时右栏不渲染"的缺席纪律测试）共同提供"系统没有卡死、
   正在做什么看得见"的信号。不打满分：判据要求的"至少让用户知道没卡死"在 HITL
   超时场景（DA-19d 已知缺口）下仍然只能等 ~30s AGENT_RUN_TIMEOUT，期间没有专门的
   "仍在等待人工裁决"提示。
10. **整体连贯性：0.7**（相对第 1 轮 0.2 分：**确认修好且有净提升**）
    `copilotkit-v2-hitl-dialog-dismiss.spec.ts` 独立重跑真实通过：HITL 终态
    弹窗遮罩（`[data-state="open"][aria-hidden="true"].fixed.inset-0.z-50`）点击
    "关闭"按钮后真的从 DOM 移除（`toHaveCount(0)`），随后发送按钮真的可点击且真的
    发出新的 `POST /api/copilotkit/`——第 1 轮记录的"唯一解法是刷新页面"的死锁
    已解除。未打满分：① 第 8 项 markdown/mermaid 仍然实测失败，会在真实使用中让
    用户看到未解析的 mermaid 围栏文本，这也是"界面呈现不一致"的一种表现；
    ② HITL 审批本身（approve/edit/reject 三个按钮）仍然从不出现，是登记在案的
    已知后端缺口（DA-19d backlog），不是新退步，但仍然是"看起来能用、实际点不到"
    这条判据关心的现象之一，只是这次不是"死锁"而是"按钮压根不渲染"。

### 总分：5.5 / 10

（0.6+0.8+0.7+0.3+1.0+0.2+0.5+0.3+0.7+0.7 = 5.8，向下取整到 0.5 步进 → **5.5**）

### 相对第 1 轮的净变化

| 项 | 第 1 轮 | 第 2 轮 | 变化 | 结论 |
|---|---|---|---|---|
| 5 语音输入 | 0 | 1.0 | **+1.0** | 确认修好（PR #1999） |
| 10 整体连贯性 | 0.2 | 0.7 | **+0.5** | 确认修好（PR #2000），但仍有其他连贯性瑕疵 |
| 6 多轮上下文 | 0.3 | 0.2 | −0.1（同一评分区间） | **PR #2004 未达到端到端可验证效果**，如实记录 |
| 8 消息呈现质量 | 0.3 | 0.3 | 0 | 仍是老样子，未被顺带修好 |
| 其余 6 项 | 未逐条给出 | 0.3–0.8 | — | 本轮首次逐条给出实测分数 |

净总分从 **5.0 → 5.5**，+0.5。提升集中在语音输入与 HITL 死锁两项（均为本轮四个
目标 PR 中的两个，货真价实修好）；多轮上下文这个第三个目标 PR **未能通过独立
复核**——这是本轮最重要的发现，不能因为 PR 已合入 main 就假设它工作。

### 按分数排序的 Gap 清单（下一轮优先级）

1. **多轮上下文（0.2，最高优先）**——PR #2004 已合入但独立回归测试确定性失败
   两次（非并行竞态）。需要有人带着实际 wire 抓包（`page.route()` 截获
   `POST /threads/:id/runs` 请求体 + `conversationLog` 服务端状态打印）复核
   `forwardedProps.chatThreadId` 是否真的在两次 `runAgent` 调用间保持一致，以及
   `loopback-deep-agent-provider.ts` 的 `FOLLOWUP_CONTEXT_TRIGGER` 分支为何没有
   命中——怀疑与 DA-19e `useConfigureSuggestions` 后台请求共享同一线程状态有关，
   未证实。
2. **消息呈现质量（0.3）**——markdown/mermaid 触发词命中后 `chat-ai-markdown`
   节点下找不到解析出的 `<h2>`，与上一条大概率同源（"上行消息内容没有正确送达/
   命中替身分支"），建议与第 6 项一起排查，可能一次修复解决两项。
3. **真实的多步能力（0.3）**——结构性限制，非本轮范围，长期存在。
4. **流式反馈（0.6）**——wire 级证据确认分片下发，但本轮未做 UI 帧级独立复核，
   下一轮建议专门录屏/截图验证真实渲染节奏。
5. **错误处理透明度（0.5）**——本轮遇到的失败大概率是 Playwright 基础设施噪音
   （上一条用例路由清理未完成），但没时间单独隔离重跑坐实，下一轮应补一次干净
   的独立验证再定分。
6. HITL 审批语义缺口（影响第 3/9/10 项）——approve/edit/reject 按钮从不出现，
   已在 DA-19d backlog 登记，非本轮新发现，仍待后端补齐"in_progress 步骤不提前
   标记为完成"的语义。

### 本轮清理
已确认本次运行产生的所有 docker compose 栈（`wsx-1b76f37...`、`wsx-e361d1f0...`
等）均已随 `with-test-isolation.ts`/Playwright 自身生命周期释放，`docker ps` 复核
仅剩一个与本轮工作无关、非本会话创建的孤儿栈（`wsx-23bbb19cb315e021f188-postgres-1`），
未触碰。隔离 worktree（`scratchpad/wt-da19g-round2`）未提交任何代码改动，仅用于
跑既有测试取证。

