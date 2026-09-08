# Chat 路径覆盖矩阵（唯一事实源）

> **这份文档只做一件事**：说清 `/chat` 的**路径全集是什么、每条被哪个 spec 覆盖、哪些还没人测**。
>
> 它**不定义**任何延迟阈值——那是 `chat-agent-performance-acceptance.md` 那张 SLO 表的事；
> 也**不定义**界面质量判据——那是 `chat-ux-acceptance-criteria.md` 与
> `chat-task-workbench-acceptance.md` 的事。本文件里出现的每一个数字都只是路径编号。
> 同一事实不得声明在两处（根 `AGENTS.md`），这份表的范围边界就是这条纪律的直接后果。

## 怎么用这份表

- **想知道某条路径有没有被测**：查下面的表，看「现有 spec」与「覆盖」两列。
- **新增一条路径**（产品长出新能力）：往表里加一行，`覆盖` 先写 `未覆盖`，
  并在「已知缺口」一节写清楚它为什么还没被测。
- **新增一条 `chat-path-*.spec.ts`**：`test()` 标题里必须带 `@path:<编号>` 标签，
  并把文件名加进 `apps/web/playwright.chat-read.config.ts` 的 `chat-path-coverage`
  项目 testMatch。两件事都由 `pnpm run lint:chat-path-coverage` 机械检查。

## 覆盖状态的定义（按这个理解，别按直觉）

| 状态 | 含义 |
| --- | --- |
| `已覆盖` | 存在一条**被 CI 门控跑到**的真实 spec，断言这条路径的用户可见行为。 |
| `部分` | 有 spec，但只覆盖这条路径的一段（表里逐条写明缺的是哪一段）。 |
| `未覆盖` | 没有任何 spec 断言它。 |
| `当前红` | 有 spec 且在跑，但当前失败——差距是真的，不是用例坏了（见各行备注）。 |

⚠ **`已覆盖` ≠ 有效**。它只说"存在一个断言该行为的真实 spec"，不保证那条 spec 拦得住回归。
本仓已多次出现「门控全绿但空转」。新增用例一律当场造反证（把被测能力改坏一行，确认会红）；
存量条目的抽查是独立的活，不在本文件的职责里。

## 路径全集与覆盖矩阵

| 路径 | 判据（用户可见行为） | 现有 spec | 覆盖 | 车道 |
| --- | --- | --- | --- | --- |
| A1 单轮文本 | 一问一答落真库，刷新后恢复同一条回复 | `agent-chat-core-paths` | 已覆盖 | chat-read |
| A2 多轮同线程 | 第二轮引用第一轮输入，两个 run 各自持久化 | `agent-chat-core-paths` | 已覆盖 | chat-read |
| A3 长会话压缩 | 早期事实被挤出 L1 后，仍活着穿过 L2 摘要层 | `chat-path-a3-long-session-fact-survival`（`test.fixme`，阻塞于 #3028） | 未覆盖 | chat-path-coverage |
| A4 线程切换 | 切走再切回不整页硬导航、不出骨架屏，历史正确恢复 | `copilotkit-v2-thread-persistence` | 已覆盖 | chat-read |
| A5 冷启动首屏 | 首次进 `/chat` 走到可输入，不停在骨架屏 | `chat-path-a5-cold-start-first-paint` | 已覆盖 | chat-read |
| B1 确认意图 | `confirm_task_intent` 可改假设并恢复同一 run | `agent-task-planning-hitl` | 已覆盖 | chat-read |
| B2 选执行方案 | `choose_execution_option` 按 optionId 选，"都不要"诚实结束为拒绝态 | `agent-task-planning-hitl` | 已覆盖 | chat-read |
| B3 补参澄清 | 宽泛请求补参后在同一持久 run 恢复，只显示一条轨迹一个产物 | `agent-task-clarification-result` | 已覆盖 | chat-read |
| B4 四选一审批 | once / forever / deny 各自的真实服务端语义；deny 不变成失败态 | `copilotkit-v2-hitl` | 已覆盖 | chat-read |
| B5 刷新恢复 | 刷新后恢复同一个 permissionRequestId，旧请求重放得 409 | `copilotkit-v2-hitl` | 已覆盖 | chat-read |
| B6 重复裁决防护 | 继续操作只提交一次，旧请求不能重复裁决 | `agent-task-planning-hitl` | 已覆盖 | chat-read |
| B7 条件性确认门 | 复杂任务先确认计划，简单问题直答不加门槛 | `chat-task-workbench-workflow-states` | 当前红 | chat-task-workbench |
| C1 画布围栏渲染 | 模型产出的 canvas 围栏真渲染成工作坊画布 | `chat-canvas-guidance-render` | 已覆盖 | chat-read |
| C2 画布编辑往返 | 最大化编辑 → 保存 → reload 重开看到保存版 → 可回到原始版 | `chat-diagram-save-reopen-roundtrip` | 已覆盖 | chat-read |
| C3 画布模板全生命周期 | 管理员建模板 → 发布 → 引导师绑定 → 该项目 chat 可达 | `core-journey-04-canvas-template-lifecycle-chat` | 已覆盖 | e2e-full |
| C4 一次生成两个模板 | 同一轮请求产出两个画布且都可用、不互相覆盖 | `chat-path-c4-two-canvases-one-turn` | 已覆盖 | chat-path-coverage |
| C5 连续多轮产物 | 连着三轮各产一个产物都不失败、不重复挂载、不互相覆盖 | `chat-path-c5-consecutive-artifact-turns` | 已覆盖 | chat-path-coverage |
| C6 Office 产物 | chat 里请求 docx / xlsx / pptx，产出可下载且可重新打开 | `apps/api` 侧有 pptx real-stack；chat 侧无 | 部分 | — |
| C7 PDF 产物 | chat 里请求 PDF，页数与逐页渲染可核 | `real-model-pdf-smoke` | 已覆盖 | real-model-smoke |
| C8 子任务产物写回 | durable subtask 产出文件回到父会话，可下载 | — | 未覆盖 | — |
| D1 工具卡片渲染 | `write_todos` / `search_documents` 定制卡片走到终态 | `copilotkit-v2-tool-rendering` | 已覆盖 | chat-read |
| D2 轨迹折叠与回放 | 默认折叠、运行中展开实时更新、刷新后可回放 | `copilotkit-v2-tool-rendering` | 已覆盖 | chat-read |
| D3 会话内挂载 skill | 临时挂载落库、刷新仍在、重复挂载幂等 | `chat-agent-skill-context` | 已覆盖 | chat-read |
| D4 skill 三态区分 | 「目录可见 / 正文送达 / 真的执行过」三者不得混为一谈 | `chat-path-d4-skill-three-states` | 已覆盖 | chat-read |
| D5 切换 agent | wire 上的 header 与回复来源都换了；不选时默认路径完好 | `copilotkit-v2-agent-switch` | 已覆盖 | chat-read |
| D6 子 Agent 折叠树 | 展开可见输入 / 工具 / 耗时 / 结果 | `chat-task-workbench-tool-events` | 当前红 | chat-task-workbench |
| E1 语音输入 | 麦克风实时转录进输入框、可编辑、发送后成为消息 | `copilotkit-v2-voice-input` | 已覆盖 | chat-read |
| E2 附件 + 视觉 | 图片进模型；能力缺席时诚实告知而非静默丢图 | `chat-vision-honest-degrade` | 已覆盖 | e2e-full |
| E3 附件预览下载 | 上传后可预览、可下载、授权正确 | `chat-attachment-preview-download` | 已覆盖 | chat-read |
| E4 运行中插话 | steering 排队到下一安全步骤，不打断当前原子步骤 | `agent-workbench-steering-acceptance` | 已覆盖 | chat-read |
| F1 错误横幅 | 真实失败出现人类可读横幅，横幅之后界面仍可用 | `copilotkit-v2-error-banner` | 已覆盖 | chat-read |
| F2 断线重连 | 网络中断（非刷新）后事件流重连并从 journal 续上，不重复不空转 | `chat-path-f2-network-drop-reconnect` | 已覆盖 | chat-read |
| F3 暂停 / 恢复 / 重试单步 | 四个控制都可点且真生效 | `agent-workbench-control-acceptance` | 当前红 | chat-read |
| F4 失败态修复 | 显示失败步骤，可重试该步 / 修改输入 | `chat-task-workbench-workflow-states` | 当前红 | chat-task-workbench |
| F5 取消传播到子任务 | 父取消后子任务不再产出、不发布晚到产物 | `apps/api` 侧有；chat 侧无 | 部分 | — |
| F6 并发双 run | 两个线程同时跑，事件不串线、不互相覆盖 | `chat-path-f6-concurrent-runs` | 已覆盖 | chat-path-coverage |
| F7 上游超时 / 断流 | 模型侧断流后 UI 诚实结束，不假装还在跑 | `chat-path-f7-upstream-stream-abort` | 已覆盖 | chat-path-coverage |

## 已知缺口（表里 `未覆盖` / `部分` 的逐条理由）

### C8 子任务产物写回 —— 缺的是编排，不是断言

`#2962`/`#2931` 打通的是「子任务在 **native 会话**里跑、用 `wx_artifact_publish` 把文件写回」。
这条链要求 `NativeSessionOwner` + 真实沙箱套接字（`kernel.module.ts` 的 `NATIVE_SESSION_OWNER`
注入点），而 `playwright.chat-read.config.ts` 这条链路起的是 `loopback-skill-sandbox.ts`，
没有 native 会话。补这条不是"再写一个 spec"，是**给这条 e2e 链路新增一套 native 编排**——
属于新增 CI 时间预算与新增 webServer，须先有人决定，不在本轮范围内。
现状诚实记录在这里，不假装它被覆盖了。

### C6 Office 产物（chat 侧）/ F5 取消传播（chat 侧）

两条都在 `apps/api` 侧有真栈测试，chat 侧没有。它们不是"没人想到"，是同一个原因：
产物生成链在 chat 侧要走沙箱执行，与 C8 撞同一堵墙（本车道没有 native 会话）。
C7（PDF）之所以有覆盖，是因为它跑在 `real-model-smoke` 那条**另外**的车道上——
那条车道自己起了执行端，不是本车道的能力。

### 性能维度：矩阵与 SLO 表的边界

矩阵里若干路径没有对应的 SLO 行（第 N 轮首字、产物端到端耗时、并发 run 劣化、
断线重连恢复时间、冷启动首屏……）。**补行的地方是那张 SLO 表**
（`chat-agent-performance-acceptance.md`），沿用它已有的两层门控与采集契约，
不在本文件里定义任何阈值——本仓已五次因"同一事实两份副本"漂移。
本文件对这件事的全部贡献，是 A5 那条 spec 落下的一个实测基线证据文件
（`apps/web/e2e/__evidence__/chat-path-coverage/a5-cold-start.json`），供加行时当参考。

## 车道与「首跑与搬家」

`chat-path-*.spec.ts` 这批新增用例跑在 `chat-path-coverage` 这个**非阻塞**车道上
（同一个 `playwright.chat-read.config.ts`、同一套 webServer，只切 testMatch；
做法与 issue #2114 摘出 `chat-task-workbench` 记分牌车道那次相同）。

**为什么先不进阻塞车道**：它们落地时尚未在 CI 上跑绿过（落地环境没有 docker daemon，
整套真栈起不来——这是诚实的边界，不是借口）。把没跑过的断言直接塞进阻塞 `e2e-full`
的车道，等于拿别人的合并路径赌自己的新用例；本仓对「恒红的门」有案底（#848：
恒红的门比没有门更糟，它同时消耗信任并训练所有人跳过它）。

**它与 `chat-task-workbench` 车道的区别**：那批是记分牌，红是**预期**状态，收敛路径是
实现能力；这批是回归门，红是**意外**状态。

**搬家条件（做完就搬，不要留在这里养老）**：某条 spec 在 `chat-path-coverage` 车道
连续两次 CI 跑绿 ⇒ 把它的文件名从 `chat-path-coverage` 的 testMatch 移进 `chat-read`
的 testMatch，并把本表「车道」列改成 `chat-read`。搬家动作由这一列跟踪，不靠人记。
首跑若为红：先判断红的是**被测路径**还是**用例本身**——前者按红的内容开 issue（那正是
这批用例的价值），后者就地修用例，两者都不许改成 `test.skip`。

## 首跑记录（2026-09-08，run 34182537257）

第一次真跑（手动 dispatch `run_chat_path_coverage=true`，2 workers）：**1 通过 / 7 失败，
且 7 条里没有一条红在被测路径的判据上**——全部死在前置步骤。逐条归因如下，方法是读
job 日志的时间线（谁在什么时刻失败、失败在哪一行），不是猜。

| 路径 | 首跑结果 | 归因 |
| --- | --- | --- |
| A5 | 通过（22.2s） | — |
| D4 / F2 / F6 / F7 | 失败（各烧掉 4–5 分钟） | **用例自己的 bug**：spec 里先 `login()`，随后 `openFreshDeepAgentThread` → `openChatEmptyState` 又登录一次；已登录状态下 `goto("/login")` 会被重定向走，`login-email` 永远不出现，`fill()` 一路等到超时。既有的 `agent-chat-core-paths.spec.ts` 从来是直接调 `openFreshThread`。已修（删掉多余那一步），并在 `openFreshDeepAgentThread` 头注里写死这条禁忌。 |
| A3 / C4 / C5 | 失败（30s 等不到输入框） | **未定**：线程列表已正确渲染（页面与 API 都活着），但老聊天屏的 `消息内容` 输入框 30s 没出现。光凭这条断言分不出「面板报错 / 还在加载 / 输入框真没渲染」。已给 `sendOnProjectThread` 加诊断（把面板错误态正文拼进失败信息），下一跑的红会自带答案。 |

⚠ 这份记录本身就是这条车道存在的理由：**没跑过的断言不算数**。首跑没能给出任何一条
路径的结论，但它给出了三条用例级缺陷——这正是「先在非阻塞车道跑，绿了再搬进阻塞车道」
要买的东西。

## 二跑记录（2026-09-08，run 34184211997）

**2 通过 / 6 失败**（首跑 1/7），并且第一次拿到了路径级结论。

| 路径 | 二跑结果 | 处置 |
| --- | --- | --- |
| A5 | 通过（连续第 2 次） | 距「搬家」还差一次绿。 |
| **D4** | **通过（首次）** | 这条路径的结论成立：目录可见 ∧ 正文送达 **不蕴含** 执行过——三个信号在这套实现里确实各自独立。 |
| A3 / C4 / C5 | 失败，但诊断给出了答案 | 新加的诊断说「面板没有错误态」⇒ 不是加载失败。查代码坐实：`/chat?projectId=…&thread=…` **早已不再渲染老聊天屏**（`app/chat/(v2)/page.tsx` 之后走 v2 壳，老的 `chat-live-message-panel` 搬去了 `/chat/live`）。本车道第一版照着 `context-engine.spec.ts` 抄了老屏锚点。已改走 v2 面板（`copilotkit-v2-*` + 回显 agent）。 |
| F2 | 失败在**自己的自检**上 | 「断网期间就已经拿到最终回答」为真 ⇒ 多步剧本在 5 秒等待窗口内就跑完了，这一跑根本没测到重连。改法：断网动作紧跟发送，剧本换成要 20 次轮询的十步滚动剧本。**自检起了作用**——它挡住了一条会假绿的用例。 |
| F6 | 失败，同一 context 的第二个 page 又走了登录 | 两个 page 共享 origin 存储 ⇒ 第二个 page 已是已登录态，`goto("/login")` 被重定向走。并发用例**需要**共享登录态（真实用户开两个标签页），所以修的是「别再登一次」，不是「换成两个 context」。已加 `openFreshDeepAgentThreadOnAuthedPage`。 |
| F7 | 失败：`copilotkit-v2-error` 120s 内 0 个 | **尚不能判定**：「替身没让 run 真的失败」与「run 失败了但 UI 不说」这两个完全不同的结论，从这条红里分不出来。已把断言顺序固定为「先权威读 run 落成 failed，再判界面」——下一跑的红会直接指向其中一个。 |

### 同一根因已被独立证实并修完（不要重复开 issue）

排查过程中我一度打算把「`context-engine.spec.ts` 仍按老屏锚点驱动那条 URL」记成待开的
issue。查 main 才发现**当天已经有人做完了**：#2890 删掉了 `/chat?projectId=` 回改旧屏的
rewrite，chat-read 车道 24 条旧屏断言一次性全红，人类裁决走**方案 B**（承认新行为，把锚点
迁到 v2，不把 rewrite 加回去），由 #3035 落地。本车道踩的是同一个根因的另一半——
再开 issue 就是重复。

**这一节留着，是因为它同时暴露了本车道的一个真实约束**：issue **#3028** —— v2 上
「深链进一条种好历史的线程」与「切到回显 agent」互斥（切 agent 会因
`key={selectedAgentId}` 卸载当前对话、开一条全新的空线程）。它决定了本车道两类用例的
不同处置：

- **需要种好的历史**（A3）：跑不起来，按 #2997 方案 B 的既有先例挂 `test.fixme` 并写明
  阻塞在 #3028——不删断言、不改宽、不 `test.skip`；#3028 补上后把 `test.fixme` 改回
  `test` 即可，正文一个字都不用动。
- **不需要历史**（C4/C5）：画布指引只依赖「组织有已发布模板」+「用户正文里带哨兵」，
  改用**新建线程 + 回显 agent**完全成立，顺带天然与别的用例隔离。曾为它们种的两条专属
  线程随之删掉——留着就是没人用的死夹具。

## 三跑记录（2026-09-08，run 34187412631）

**3 通过 / 4 失败 / 1 skipped**（首跑 1/7 → 二跑 2/6 → 三跑 3/4）。

| 路径 | 三跑结果 | 处置 |
| --- | --- | --- |
| A5 | 通过（连续第 3 次） | **已搬进 `chat-read` 阻塞车道**（见下）。 |
| D4 | 通过（连续第 2 次） | **已搬进 `chat-read` 阻塞车道**。 |
| **F2** | **通过（首次）** | 路径结论成立：网络中断后 run 在服务端继续，网络恢复后**不刷新**界面自己续上，且用户消息与最终回答各只落库一条、挂在同一次 run 上。二跑那条自检（"断网期间就已经拿到最终回答"）换成十步滚动剧本之后不再命中，说明这一跑真的跨过了断网窗口。 |
| A3 | skipped | `test.fixme`，阻塞于 #3028，见上。 |
| F6 | 失败：`threadA === threadB` | **用例 bug**：第二个 page `goto("/chat")` 之后壳会恢复到最近一条线程（正是第一个 page 刚建的那条），URL 当场就匹配 `waitForURL` 的正则 ⇒ 立即返回、取到别人的线程 id。已改成「等 URL 变成一条与点击前**不同**的线程」。⚠ 值得记一笔：把它拦下来的正是这条用例**自己**的前置断言（"两条线程必须是不同的线程"）——没有它，这一跑会以"并发不串线"的假绿收场。 |
| F7 | 失败：`humanTurn` 为 undefined | **用例竞态**：UI 上出现那句话 ≠ 它已经写进库，而本条发送后直接读库。已新增 `awaitStoredHumanMessage`——要读库就先等库。 |
| C4 / C5 | 失败：180s 等不到画布围栏 / 第 1 轮就 0 个画布 | **尚不能判定**：等不到期待的串时，「这一轮根本没有回复」「回复来自另一个 agent（#3028 换 agent 开新对话）」「回复来了但没命中画布分支」三者从超时里分不出来。已给 `sendInV2AndAwaitStoredReply` 加诊断：失败时把该线程**真实落库的 agent 回复**摘进失败信息。判据没有放宽。 |

### 搬家：A5 与 D4 已进阻塞车道

按上面「首跑与搬家」定的条件（连续两次 CI 跑绿），A5（三跑三绿）与 D4（二跑、三跑连绿）
已从 `chat-path-coverage` 的 testMatch 移进 `chat-read`，本表「车道」列同步改成 `chat-read`。
门控第 ④ 条也随之改成**按本表车道列判定**（而不是写死 `chat-path-coverage`）——把车道写死
等于让搬家永远过不了这道门。改了列没改 config、或反过来，都会红：本次搬家时它就先红了一次
（config 改完、车道列没改），随后才绿。

## 四跑记录（2026-09-08，run 34190269467）

**2 通过 / 3 失败 / 1 skipped**（首跑 1/7 → 二跑 2/6 → 三跑 3/4 → 四跑 2/3；分母在缩小是因为
绿了的两条已经搬去阻塞车道，不再在本车道计数）。这一跑第一次让**每一条红都指向一个确定的
结论**——三跑埋的两处诊断都兑现了。

| 路径 | 四跑结果 | 处置 |
| --- | --- | --- |
| **F7** | **通过（首次）** | 三跑那条「`humanTurn` 为 undefined」确认是用例竞态，`awaitStoredHumanMessage` 修掉了。路径结论成立：上游 SSE 发过正文后直接销毁 socket（既无 EOF 也无错误终态），`tryStreamRun` 的 catch 真的落回轮询问到权威状态，run 落 `failed`、界面出可读横幅、发送态解除、下一轮还能发出去——**没有出现「界面假装还在跑」**。距搬家还差一次绿。 |
| **F2** | **通过（连续第 2 次）** | **已搬进 `chat-read` 阻塞车道**（testMatch 与本表车道列同步改）。 |
| A3 | skipped | `test.fixme`，阻塞于 #3028，未变。 |
| **C4 / C5** | 失败，**诊断给出了确定答案** | 见下节——是**替身的分支次序**问题，既不是产品缺陷也不是断言写错。 |
| F6 | 失败：`threadA === threadB`（**第二次**） | 三跑的修法只是换了个近似，还是被同一件事绕过——见下节。 |

### C4 / C5：诊断兑现，根因是替身的分支次序（已修）

三跑给 `sendInV2AndAwaitStoredReply` 埋的诊断这一跑直接把答案打了出来。C4 那条线程真实
落库的 agent 回复是：

```
[loopback] [skill:]MOUNTPROOF-9317 帮我并排出两张图，代号 E2E-CANVAS-GUIDANCE-6031 E2E-CANVAS-DUAL-4417⏎⏎```run_script⏎const pptxgenjs = require('pptxgenjs');…
```

三种可能就此分开：**有回复**（不是 run 没跑）、**来自对的 agent**（`[loopback]` 前缀 =
回显 agent，说明 `openFreshEchoAgentThread` 那条绕开 #3028 的路子成立）、**没命中画布分支**
（回的是试跑脚本围栏）。

根因在 `loopback-model-provider.ts` 的分支链次序：`isTrialRunRequest` 自 #2514 起
**对任何一次接了沙箱的普通聊天都成立**（它自己的头注就是这么写的），而画布分支排在它
后面 ⇒ 在这套装配下**画布分支根本到不了**。画布分支的判定要三个信号同时成立、其中一个
是只出现在本次请求正文里的哨兵（#2295）——specific 的判定被 ambient 的判定永久遮住了。

已把画布分支移到试跑分支之前（仍排在追问建议之后：追问建议那次调用会把对话历史一起送上来，
`echoed` 因此含同一个哨兵，提到它前面会被劫走）。「追问建议 vs 试跑」的相对次序跟着换了，
这一换有据可查是空操作：追问建议的 system prompt 由 `generate-followup-suggestions.ts`
整条替换，`RUN_SCRIPT_PROTOCOL_PROMPT` 只由 `execute-run.ts` 往 agent-run 的 system prompt
尾部拼，两者不可能同时成立。**正文不带那个哨兵的请求，走到的分支与改动前逐字节相同。**

⚠ 顺带修掉 C5 一个会让诊断失声的缺陷：它等的串是 `SERIAL-<轮次>`，而**通用回显分支也满足**
（回显里就带着用户原文）⇒ 没产出任何围栏时这一步照样通过，红被推迟到后面的数量断言上，
诊断一次都没打印。等待条件必须是**只有被测分支才满足**的那个串。轮次标记仍逐轮核对，只是
挪到了后面那段权威读里。

### F6：同一件事的第二个近似，改用「这条线程此前不存在」

三跑把信号从「URL 匹配线程正则」改成「URL 变成一条**不同**的线程」，四跑照样红。因为壳的
「恢复到最近一条线程」是**异步**的：`before` 快照取在恢复落地之前（此时还是裸 `/chat`，
`before` 为 null），随后满足「变成了不同的线程」的正是那次**恢复**，不是我们的创建。

两次近似都在用「变化」指代「新建」，而这条 URL 上至少有两个东西会让它变化。改法是换一个
**恢复动作无论早到晚到都无法满足**的判据：先用权威读（`GET /chat/threads`）取回点击前已存在
的全部线程 id，再等 URL 落在一个**不在这个集合里**的 id 上——恢复只能恢复到已存在的线程。

⚠ 与三跑同一句话值得再记一次：两跑都是这条用例**自己的前置断言**把自己拦下来的。没有它，
这两跑都会以「并发不串线」的假绿收场。

## 机械门控

`pnpm run lint:chat-path-coverage`（`.harness/scripts/lint-chat-path-coverage.mjs`）检查四条：

1. 表里每一行的编号唯一、格式合法（`A1`…`F7` 这样的字母+数字）。
2. 每个 `chat-path-*.spec.ts` 的 `test()` 标题里都有 `@path:<编号>` 标签，且该编号在表里存在。
3. 表里凡是被 `chat-path-*` spec 覆盖的行，仓库里真有一条带对应标签的用例。
4. 每个 `chat-path-*.spec.ts` 都被 `playwright.chat-read.config.ts` 的
   `chat-path-coverage` testMatch 捞得到——「写了但没人跑」（#512）在本车道内先挡一道。

**它挡不到什么（写清楚，免得有人以为这道门比实际更强）**：存量 spec（`copilotkit-v2-*`、
`agent-*` 等）没有 `@path:` 标签——给 25 个既有文件改测试标题是一次跨文件的大范围改动，
收益（表里那一列本来就写着文件名，文件名是否存在同样可机械查）不足以抵掉风险。
所以第 3 条只对本车道成立；「表里写了某个既有 spec，而那个文件其实已被删/改名」由第 1 条
之外的一条文件存在性检查兜底。跨越这道边界（给全部既有 spec 打标签）是另一件事，
要做就单独做，不要顺手混进别的 PR。
