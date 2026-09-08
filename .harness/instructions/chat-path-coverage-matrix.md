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
| A3 长会话压缩 | 早期事实被挤出 L1 后，仍活着穿过 L2 摘要层 | `context-engine`（结构）+ `chat-path-a3-long-session-fact-survival`（事实） | 已覆盖 | chat-read + chat-path-coverage |
| A4 线程切换 | 切走再切回不整页硬导航、不出骨架屏，历史正确恢复 | `copilotkit-v2-thread-persistence` | 已覆盖 | chat-read |
| A5 冷启动首屏 | 首次进 `/chat` 走到可输入，不停在骨架屏 | `chat-path-a5-cold-start-first-paint` | 已覆盖 | chat-path-coverage |
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
| D4 skill 三态区分 | 「目录可见 / 正文送达 / 真的执行过」三者不得混为一谈 | `chat-path-d4-skill-three-states` | 已覆盖 | chat-path-coverage |
| D5 切换 agent | wire 上的 header 与回复来源都换了；不选时默认路径完好 | `copilotkit-v2-agent-switch` | 已覆盖 | chat-read |
| D6 子 Agent 折叠树 | 展开可见输入 / 工具 / 耗时 / 结果 | `chat-task-workbench-tool-events` | 当前红 | chat-task-workbench |
| E1 语音输入 | 麦克风实时转录进输入框、可编辑、发送后成为消息 | `copilotkit-v2-voice-input` | 已覆盖 | chat-read |
| E2 附件 + 视觉 | 图片进模型；能力缺席时诚实告知而非静默丢图 | `chat-vision-honest-degrade` | 已覆盖 | e2e-full |
| E3 附件预览下载 | 上传后可预览、可下载、授权正确 | `chat-attachment-preview-download` | 已覆盖 | chat-read |
| E4 运行中插话 | steering 排队到下一安全步骤，不打断当前原子步骤 | `agent-workbench-steering-acceptance` | 已覆盖 | chat-read |
| F1 错误横幅 | 真实失败出现人类可读横幅，横幅之后界面仍可用 | `copilotkit-v2-error-banner` | 已覆盖 | chat-read |
| F2 断线重连 | 网络中断（非刷新）后事件流重连并从 journal 续上，不重复不空转 | `chat-path-f2-network-drop-reconnect` | 已覆盖 | chat-path-coverage |
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
