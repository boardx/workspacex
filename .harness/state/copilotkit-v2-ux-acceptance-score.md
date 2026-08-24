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

## 第 3 轮（覆盖 `4d959a65`）

- **评分日期**：2026-08-25
- **实测 SHA**：`4d959a651304f2d881da2d087afe1d9ba7eea7db`（`origin/main`，PR #2007
  的合并提交，`git merge-base --is-ancestor` 隐含成立——该 commit 本身就在
  `origin/main` 分支尖端，`git log --oneline -1 origin/main` 直接核对过）。
- **方法**：独立隔离 worktree（`scratchpad/wt-da19g-round3`，未碰共享主目录），
  跑 `./init.sh` 确认基础环境后执行 `pnpm run verify:chat-read`（真实 Chromium +
  真 Postgres/Redis + 真 API + Next dev + 确定性 deep-agent/ASR loopback 替身），
  覆盖 `apps/web/e2e/` 下全部相关 spec（37 个用例，含全部 8 个
  `copilotkit-v2-*.spec.ts` 文件）。**先用 `git diff --stat` 核实第 2 轮 SHA
  （`1bf25a75`）到本轮 SHA 之间只有两个文件改动**（`loopback-deep-agent-provider.ts`
  的真根因修复 + `copilotkit-v2-runtime-adapter.spec.ts` 一处 strict-mode 定位符
  修复），没有其它产品代码被顺带改动——这决定了本轮的复核范围：其余 8 项按第 2 轮
  方法论重新走查一遍确认无退步，只在第 6/8 两项做深挖。对第 6/8 两项目标回归测试
  和一个可疑的第三方基础设施噪音（认证测试）分别做了**独立单进程隔离重跑**（不止
  全量并行跑一次就下结论），排除并行竞态导致的假阳性/假阴性。

### 逐项分数

1. **流式反馈：0.6**（与第 2 轮相同，本轮无相关代码改动，未重新独立复核帧级时序，
   延续第 2 轮记录的"wire 级证据确认分片下发，UI 侧逐帧渲染时序仍未做独立复核"这一
   保留意见）。
2. **可见的规划步骤：0.8**（与第 2 轮相同）
   `copilotkit-agui-state-snapshot.spec.ts` 本轮全量跑真实通过（8.6s），未见退步。
3. **可见的工具调用与进度：0.7**（与第 2 轮相同）
   `copilotkit-v2-tool-rendering.spec.ts` 两条测试（`write_todos`/`search_documents`
   定制卡片）本轮全量跑真实通过，未见退步，`search_documents` 结果文本仍受同一条
   "已知限制③"约束，不打满分。
4. **真实的多步能力：0.3**（与第 2 轮相同，未变）
   loopback 替身仍是确定性剧本，非真实模型推理，本轮未改变这个事实。
5. **语音输入体验：1.0**（与第 2 轮相同）
   `copilotkit-v2-voice-input.spec.ts` 本轮全量跑真实通过（8.5s），未见退步。
6. **多轮上下文：1.0**（相对第 2 轮 0.2 分：**确认修好，本轮核心验证目标**）
   `copilotkit-v2-runtime-adapter.spec.ts` 的 DA-19g 回归测试本轮**两次独立运行
   均真实通过**——第一次在 37 用例全量跑（5 worker 并行）里通过（7.7s），第二次
   单独用 `--workers=1` 隔离重跑再次通过（5.0s），排除了"恰好在某种并行时序下侥幸
   过"的可能。测试直接读取 `page.getByTestId("copilotkit-v2-messages")` 这个真实
   渲染出来的消息列表 DOM（不是只读 wire/state 端点）：连续发两条消息，第二条命中
   `深agent FollowupContextTrigger`（字面量"取证：还记得我上一句说的是什么吗"），
   断言浏览器里真实可见的第二轮回复文本同时满足三个条件——① 包含确定性回显前缀
   `[remembered:]`（证明命中的是本次新增分支，不是通用兜底模板恰好撞上同样文字）；
   ② 逐字包含第一轮原文"DA-19g 第一轮：记住这句暗号 ZEBRA-4471"；③ **不**包含
   "没有上一轮可引用"这句诚实拒绝分支的文案（反向对照，排除命中了错误分支）。三条
   断言全部通过，证明 PR #2007 的真根因修复（`/stream` 端点补齐
   `computeSpecialTurnReply` 共享函数）端到端生效——第 2 轮记录的"传输层/线程续接
   全部正确，但用户看到的聊天气泡仍是通用模板"这个 gap 已经关闭。
7. **错误处理透明度：0.5**（与第 2 轮相同，但本轮把第 2 轮"没时间坐实"的不确定性
   补上了：`copilotkit-v2-runtime-adapter.spec.ts` 的"清空 token 后必须失败"用例
   在全量跑里再次报了失败，本轮专门单独隔离重跑（`--workers=1`，只跑这一条），
   **真实通过**（27.6s）——失败堆栈同样是"上一条用例的 `route.fetch()` 仍在飞行中"
   这个 Playwright 基础设施伪影特征，与第 2 轮记录的现象同源。这次坐实了它确实是
   并行噪音、不是功能性回归，但因为这条用例本身验证的是"清空 token 后 wire 字节里
   不出现真实回显"（后端拒绝层面），不是"界面上是否展示了一条失败提示"（判据第 7
   项真正要的东西），所以本轮仍不据此上调分数，只更新"确认为噪音"这一事实状态。
8. **消息呈现质量：1.0**（相对第 2 轮 0.3 分：**确认修好，本轮核心验证目标**）
   `copilotkit-v2-runtime-adapter.spec.ts` 的"DA-19b markdown/mermaid 消息渲染"
   回归测试本轮**两次独立运行均真实通过**——全量跑（18.0s）与单进程隔离重跑
   （31.3s）结果一致。命中触发词"取证：请用 markdown 展示能力"后，`chat-ai-markdown`
   容器下断言到的是真实解析出的结构化 DOM 节点，不是原始语法文本：`<h2>` 标题
   （"分析结果"）、行内 `<code>`（"pnpm harness verify"）、`<blockquote>` 引用块、
   以及 ```mermaid 围栏渲成的 `[data-testid="chat-diagram-fabric"]` fabric canvas
   （非灰底代码块）。PR #2007 修复的真根因（`/stream` 端点此前从未判断
   `MARKDOWN_TRIGGER`）已通过独立复核证实端到端生效。
9. **控制感：0.7**（与第 2 轮相同）
   `write_todos` 两态卡片 + `ActiveFilePanel` 两条测试本轮全量跑均真实通过，未见
   退步。HITL 超时场景仍缺"仍在等待人工裁决"专门提示，未打满分的理由不变。
10. **整体连贯性：0.7**（与第 2 轮相同）
    `copilotkit-v2-hitl-dialog-dismiss.spec.ts` 本轮全量跑真实通过（1.2m），HITL
    死锁未复发。不打满分的**主因不变**：HITL 审批本身（approve/edit/reject 三个
    按钮）仍然从不出现（DA-19d 已知后端缺口，本轮未涉及）。第 2 轮记录的"markdown/
    mermaid 渲染失败也是一种连贯性瑕疵"这条次要理由本轮已随第 8 项修好而消失，但
    主因（HITL 按钮不渲染）仍在，所以维持 0.7 而非上调——避免把"次要理由消失"误
    读成"主因解决了"。

### 总分：7.0 / 10

（0.6+0.8+0.7+0.3+1.0+1.0+0.5+1.0+0.7+0.7 = 7.3，向下取整到 0.5 步进 → **7.0**）

### 相对第 2 轮的净变化

| 项 | 第 2 轮 | 第 3 轮 | 变化 | 结论 |
|---|---|---|---|---|
| 6 多轮上下文 | 0.2 | 1.0 | **+0.8** | 确认修好（PR #2007 真根因修复，两次独立隔离复核） |
| 8 消息呈现质量 | 0.3 | 1.0 | **+0.7** | 确认修好（同一 PR #2007，同一根因，两次独立隔离复核） |
| 7 错误处理透明度 | 0.5 | 0.5 | 0（不确定性已消除） | 坐实了"清空 token"用例失败是并行噪音，非回归，但不改变分数 |
| 其余 7 项 | 0.6/0.8/0.7/0.3/1.0/0.7/0.7 | 同左 | 0 | 本轮未改动相关代码，全量跑逐一确认无退步 |

净总分从 **5.5 → 7.0**，**+1.5**——本轮四个目标 PR 中最后一个（多轮上下文，PR
#2004→#2007 两次尝试）与其连带修复的第 8 项**这次是真的端到端验证过、不是自评满分**：
两项都用了"全量并行跑 + 单进程隔离重跑"两次独立证据链，且直接断言浏览器渲染出来的
真实 DOM/可见文本，不是只看 wire/state 端点或 commit message 的自我描述。

### 按分数排序的 Gap 清单（下一轮优先级）

1. **真实的多步能力（0.3，结构性限制，长期存在）**——loopback 替身是确定性剧本，
   非真实模型推理，`chat-ux-acceptance-criteria.md` 已知结构性限制段落承认这一点，
   不是"下一轮该修"的东西，除非人类决定要接入真实模型评测。
2. **错误处理透明度（0.5）**——本轮已坐实"清空 token"用例的失败是 Playwright 并行
   噪音而非功能回归，但判据第 7 项真正要的"界面上是否如实展示失败"这件事仍未被
   一条专门断言 UI 可见失败提示的测试覆盖过，下一轮建议补一条这样的用例再定分。
3. **流式反馈（0.6）**——wire 级证据确认分片下发，但仍未做 UI 帧级独立复核（录屏/
   截图验证真实渲染节奏），第 2 轮就已列为待办，本轮未推进。
4. **控制感 / 整体连贯性（各 0.7）**——HITL 审批 approve/edit/reject 按钮从不出现
   （DA-19d backlog 登记的已知后端缺口）仍是这两项拿不到满分的共同主因，需要后端
   补齐"in_progress 步骤不提前标记为完成"的语义才能解锁。
5. **可见的工具调用与进度（0.7）**——`search_documents` 卡片结果文本断言仍受"已知
   限制③"约束（不强断言具体结果文本），可考虑下一轮补齐这条断言的强度。

### 本轮清理
本轮产生的 docker compose 栈（全量跑一次 + 单进程隔离重跑两次，共三轮
`with-test-isolation.ts` 生命周期）均已随 Playwright/isolation 脚本自身的
teardown 释放，`docker ps` 复核未见本会话产生的孤儿栈残留。隔离 worktree
（`scratchpad/wt-da19g-round3`）未对产品代码做任何改动，仅用于跑既有测试取证
与提交本状态文件。

## 第 4 轮（覆盖 `79ea2504`）

- **评分日期**：2026-08-25。
- **实测 SHA**：`79ea2504789cd154cdecc0750fb6ecf7aa59f2f1`（`origin/main` 分支尖端，
  `git log --oneline -1 origin/main` 直接核对——就是 PR #2010 的合并提交本身，
  不需要单独跑 `merge-base --is-ancestor`）。
- **方法**：独立隔离 worktree（`scratchpad/wt-da19g-round4`，未碰共享主目录），
  跑 `./init.sh` 确认基础环境后，先用 `git diff --stat` 核实第 3 轮 SHA
  （`4d959a65`）到本轮 SHA 之间的改动范围——只有
  `copilotkit-agui.controller.ts`（`writeToolCallStep`/`isHitlResumeRequest`/
  `parseHitlDecision`/新增 `resolvedChatThreadIdByClientThreadId` 关联缓存）、
  `agui-bridge.ts`（`resumeAguiBridgeTurn`/轮询认识 `awaiting_approval`）、
  `apps/api/tests/agent-runtime/agui-bridge-hitl.test.ts`（新增单测）、
  `apps/web/e2e/copilotkit-v2-hitl.spec.ts`（改写为断言修好后的行为）、
  `apps/web/e2e/copilotkit-v2-hitl-dialog-dismiss.spec.ts` 五个文件——这决定了
  本轮复核范围：核心验证目标是本轮任务书点名的 approve/edit/reject 三条路径，
  其余 8 项按第 3 轮方法论重新走查一遍确认无退步。
  跑 `pnpm run verify:chat-read`（真实 Chromium + 真 Postgres/Redis + 真 API +
  Next dev + 确定性 deep-agent/ASR loopback 替身），覆盖全部 8 个
  `copilotkit-v2-*.spec.ts` 文件（39 个用例，5-worker 全量并行一次）。

### HITL approve/edit/reject 三条路径——本轮核心验证目标

**不只信 PR 描述**：先读了 `copilotkit-agui.controller.ts` 的实际 diff（不是只读
commit message 的自我陈述），确认 `writeToolCallStep` 新增的 `isPendingApproval`
参数确实只在"该 step 上报时 run 整体状态真的是 `awaiting_approval`"这个精确条件下
才生效（`step.status === "in_progress" && isPendingApproval`），普通"进行中"工具调用
（如 `search_documents`）的原有播报逻辑完全没被触碰——这与 PR 描述里"第一版实现
范围过宽、已收窄"的说法在代码层面对得上，不是自我表扬式的空话。

`apps/web/e2e/copilotkit-v2-hitl.spec.ts`（本轮全量跑真实通过，三条测试全绿）用
真实 Chromium 走了三条完整路径，且每条都同时做了 **UI 层断言**（按钮真的可见、
点击真的生效、最终消息文本真的出现）和 **wire 层反证**（拦截真实
`POST /api/copilotkit/agent/default/run` 的原始 SSE 帧，不是读高层状态快照）：

- **Approve**（13.1s）：`copilotkit-v2-hitl-approve`/`start-edit`/`reject` 三个
  按钮真的渲染出来（不再是只读分支），点击 approve 后对话框立即卸载，
  `copilotkit-v2-send` 重新可点击，且用 `expect.poll(() => capturedBodies.length)`
  等到了**第二次**真实 `POST` round-trip（不是只看 UI 状态就假设 resume 发生了），
  最终消息里出现"已按原参数发送"。wire 级反证：两次 POST 里没有任何一次带
  `RUN_ERROR`；第一轮 `TOOL_CALL_END` 之后确认没有紧跟着空 `TOOL_CALL_RESULT`
  ——这正是 DA-19g 要修的那个核心 bug 信号，本轮直接断言它不再出现。
- **Edit**（13.1s）：编辑 JSON 参数（`subject`/`body` 换成"已编辑：请今日发出
  （DA-19g 实测）"等标记文本）后提交，断言最终消息里出现的是**编辑后的正文**，
  且**不**包含原始正文——这条断言直接验证了"编辑后的参数值真的传到了下游"，
  不是"表单能编辑但后端仍用原值"这种半吊子实现。
- **Reject**（11.1s）：点击 reject 后，wire 层断言 resume 那一轮以
  `RUN_ERROR` 收场且 `code === "HITL_REJECTED"`——一个明确的拒绝终态，不是
  静默卡住，也不是被误判为 `AGENT_RUN_TIMEOUT`（旧 bug 的收场方式）。

三条路径均满足任务书要求的验证目标。**已知作用域限制**（如实转述自 diff 注释，
不是猜测）：`resolvedChatThreadIdByClientThreadId` 关联缓存是单进程内存级 Map，
用于把 `useHumanInTheLoop.respond()` 触发的无 `forwardedProps` follow-up 请求路由
回正确的 run——进程重启会丢失这个关联，届时 resume 会走
`NoAwaitingApprovalRunError` 这个诚实失败分支（不是静默数据丢失，run 本身仍
安全落在 Postgres 的 `awaiting_approval` 状态），但本轮评分环境是单进程单会话，
未触发这条边界。

### 逐项分数

1. **流式反馈：0.6**（与第 3 轮相同，本轮改动与此项无关，未补做 UI 帧级独立复核，
   延续第 2/3 轮记录的保留意见——下一轮如有时间应专门补一次录屏/截图验证）。
2. **可见的规划步骤：0.8**（与第 3 轮相同）
   `copilotkit-agui-state-snapshot.spec.ts` 本轮全量跑真实通过，未见退步。
3. **可见的工具调用与进度：0.7**（与第 3 轮相同，本轮重点复核对象之一）
   `copilotkit-v2-tool-rendering.spec.ts` 两条测试（`write_todos`/
   `search_documents` 定制卡片）本轮全量跑真实通过——PR #2010 描述提到实现过程中
   撞过一次"笼统改动导致 `search_documents` 卡片渲染回归"，本轮已用上面读到的
   `isPendingApproval` 精确判据在代码层面确认收窄范围不会连带影响这条路径，且
   测试本身真实通过，坐实"没有回归"。`search_documents` 结果文本断言仍受文件头注
   "已知限制③"约束，不打满分。
4. **真实的多步能力：0.3**（与第 3 轮相同，结构性限制，未变）。
5. **语音输入体验：1.0**（与第 3 轮相同）
   `copilotkit-v2-voice-input.spec.ts` 本轮全量跑真实通过，未见退步。
6. **多轮上下文：1.0**（与第 3 轮相同）
   `copilotkit-v2-runtime-adapter.spec.ts` 的 DA-19g 多轮上下文回归测试本轮全量跑
   真实通过，未见退步。
7. **错误处理透明度：0.5**（与第 3 轮相同）
   全量跑里"清空 token 后必须失败"用例再次报了失败，失败堆栈仍是同一个
   "route.fetch: Test ended"特征（`copilotkit-v2-runtime-adapter.spec.ts:161`，
   拦截一条与本用例断言无关的后台请求时 `route.fetch()` 还在飞行中就被测试结束
   打断）——与第 2/3 轮记录的现象逐字节同源，本轮据此判定为已知的并行/清理噪音，
   不是新回归，但仍未补上判据第 7 项真正要的"断言 UI 可见失败横幅"的测试，分数
   不变。
8. **消息呈现质量：1.0**（与第 3 轮相同）
   markdown/mermaid 回归测试本轮全量跑真实通过，未见退步。
9. **控制感：1.0**（相对第 3 轮 0.7 分：**确认修好，本轮核心验证目标之一**）
   第 3 轮不打满分的主因是"HITL 超时场景下期间没有专门的『仍在等待人工裁决』提示，
   只能干等 ~30s `AGENT_RUN_TIMEOUT`"。本轮验证的 approve/edit/reject 三条路径
   证明这个主因已经消失：`copilotkit-v2-hitl-approve`/`start-edit`/`reject` 三个
   可交互按钮在触发审批后 30s 内真实渲染出来（三条测试分别在 13.1s/13.1s/11.1s
   内完成整条 approve→resume→最终消息的全链路，不是卡到超时），这本身就是判据
   第 9 项要的"用户能看到系统现在在做什么、没有卡死"信号——而且比"进度指示"更强：
   用户不仅知道没卡死，还能直接采取行动（批准/编辑/拒绝），不必干等。
10. **整体连贯性：1.0**（相对第 3 轮 0.7 分：**确认修好，本轮核心验证目标之一**）
    第 3 轮记录的"不打满分的主因"逐字是"HITL 审批本身（approve/edit/reject 三个
    按钮）仍然从不出现"——这正是本轮 PR #2010 的目标且已用三条真实浏览器路径
    （UI 断言 + wire 级反证双重证据）确认修好，第 2 轮遗留的"死锁"问题
    （PR #2000）此前已确认修好且本轮全量跑未见复发。本轮未发现其余假按钮/死链接/
    风格孤岛类问题（8 个 spec 文件全量跑 38/39 通过，唯一失败项已定性为已知
    infra 噪音，非功能回归）。

### 总分：7.5 / 10

（0.6+0.8+0.7+0.3+1.0+1.0+0.5+1.0+1.0+1.0 = 7.9，向下取整到 0.5 步进 → **7.5**）

### 相对第 3 轮的净变化

| 项 | 第 3 轮 | 第 4 轮 | 变化 | 结论 |
|---|---|---|---|---|
| 9 控制感 | 0.7 | 1.0 | **+0.3** | 确认修好（PR #2010，HITL 按钮渲染） |
| 10 整体连贯性 | 0.7 | 1.0 | **+0.3** | 确认修好（PR #2010，approve/edit/reject 三条路径实测通过） |
| 其余 8 项 | 0.6/0.8/0.7/0.3/1.0/1.0/0.5/1.0 | 同左 | 0 | 本轮全量跑逐一确认无退步 |

净总分从 **7.0 → 7.5**，**+0.5**——本轮唯一目标 PR（#2010，HITL 审批语义）
货真价实修好，且用真实浏览器三条路径（不是只信 PR 描述）+ 全量回归跑双重验证，
未发现连带回归。

### 是否达标（10 分门槛）

**未达标**，还差 2.5 分。DA-19g backlog 关心的"新轨道分数 ≥ 旧轨道 7/10 天花板"
这个前置条件**已经满足**（7.5 > 7.0），但人类原话要求的是"必须要达到 10 分才
停止"——这是另一个更高的门槛，尚未到达，**不建议现在评估翻转默认值**，
应继续按 Gap 清单迭代。

### 按分数排序的 Gap 清单（下一轮优先级）

1. **真实的多步能力（0.3，结构性限制，长期存在）**——loopback 替身是确定性剧本，
   非真实模型推理，不是"下一轮该修"的东西，除非人类决定要接入真实模型评测。
2. **错误处理透明度（0.5）**——三轮下来"清空 token"用例的失败已经反复坐实是
   Playwright 并行/清理噪音（非功能回归），但判据第 7 项真正要的"界面上是否
   如实展示失败"这件事仍未被一条专门断言 UI 可见失败横幅的测试覆盖过——这是
   目前**分数最低的、真正可以下一轮动手修的**一项，建议优先。
3. **流式反馈（0.6）**——wire 级证据确认分片下发，但仍未做 UI 帧级独立复核
   （录屏/截图验证真实渲染节奏），第 2 轮就已列为待办，三轮过去仍未推进，
   建议下一轮真正花时间做一次。
4. **可见的工具调用与进度（0.7）**——`search_documents` 卡片结果文本断言仍受
   "已知限制③"约束（不强断言具体结果文本），可考虑下一轮补齐这条断言的强度。
5. 其余 5 项（规划步骤 0.8、语音 1.0、多轮上下文 1.0、消息呈现 1.0、控制感 1.0、
   整体连贯性 1.0）暂无已知具体缺口，维持现状，本轮全量回归确认。

### 本轮清理
本轮产生的 docker compose 栈（全量跑一次 + 单进程隔离重跑一次，因该重跑用了错误的
`-g` 过滤参数导致命中全部 39 个用例而非目标单条用例、以单 worker 串行方式运行,
判断耗时过长后主动 `pkill` 终止）——已确认终止后手动 `docker compose -p
wsx-80639954f22eed43dd96 down -v` 释放，`docker ps` 复核确认该栈已完全移除。
唯一剩余的 `wsx-23bbb19cb315e021f188-postgres-1` 是本会话开始前就存在的孤儿栈
（与第 3 轮记录的是同一个），非本轮产生，未触碰。隔离 worktree
（`scratchpad/wt-da19g-round4`）未对产品代码做任何改动，仅用于跑既有测试取证
与提交本状态文件。

