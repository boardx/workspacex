export const CHAT_READ_E2E = {
  email: "chat-read-e2e@example.test",
  password: "Chat-read-E2E-only-405!",
  orgId: "org-chat-read-e2e",
  userId: "user-chat-read-e2e",
  projectId: "project-chat-read-e2e",
  threadId: "thread-chat-read-e2e",
  agentId: "agent-chat-read-e2e",
  /**
   * #467：**只在组织 agent 目录（`org_agents`）里、不在本线程编制里**的第二个 agent。
   *
   * 它存在的全部意义是让「把一个 agent 加进这个会话」构造得出来——`agentId` 那个
   * 一开始就在编制里，拿它做加入用例的话，一个什么都没做的实现也会绿。
   */
  catalogOnlyAgentId: "agent-chat-read-e2e-catalog-only",
  /**
   * #728 P6/P7 —— 确定性模型提供方的标识对（`agent_versions.model_provider`/`model_id`
   * 与 `KERNEL_MODEL_PROVIDER` 两头共用同一份字面量）。命名跟随
   * `fullstack-smoke-fixture.ts` 的 `agentModelProvider`/`agentModelId`/`agentReplyPrefix`
   * 同一套惯例，取自 chat-read 自己的隔离端口段，不与它撞名。
   *
   * ⚠ 两个字符串是任意值——`ConfiguredModelProvider` 只比对「run 快照里存的
   * model_provider」与「进程启动时 KERNEL_MODEL_PROVIDER」是否一致，不查真实
   * provider 注册表，所以这里不需要是 dashscope/openai 之类的真名字。
   */
  agentModelProvider: "chat-read-loopback",
  agentModelId: "loopback-echo",
  agentReplyPrefix: "[loopback]",
  /**
   * #728 P6/P7 —— 第二个 agent，专门走 `deep-agent` provider（真实的
   * `DeepAgentModelProvider` 代码路径，上游换成 `loopback-deep-agent-provider.ts`
   * 这个确定性替身，见那个脚本自己的头注）。取证要证明的是「计划句 + 工具调用步骤
   * 真的渲染出来」，这条 provider 的产品实现（`execute-run.ts` 的
   * `completeWithProgress` 分支、`extractToolCallEvents`）此前**从未被任何 e2e 走过**，
   * 只有单元测试覆盖过 HTTP 客户端本身——本条 agent 是这条路径第一次被端到端跑通。
   *
   * `deepAgentModelProvider` 必须逐字等于 `DEEP_AGENT_PROVIDER_NAME`
   * （`deep-agent-model-provider.ts` 导出的常量，值是 `"deep-agent"`）——它不是像
   * 上面 `agentModelProvider` 那样的任意字符串，`RoutingModelCallPort` 按这个值
   * 做**精确路由**（不是「碰巧配置成什么就是什么」，是这一个 provider 实现只服务
   * 这一个固定名字）。
   */
  deepAgentId: "agent-chat-read-e2e-deep",
  deepAgentDisplayName: "Deep Research Agent",
  deepAgentModelProvider: "deep-agent",
  deepAgentModelId: "deep-agent-loopback",
  /**
   * #728 P9 —— 失败态取证。用户消息逐字等于这个值时，`loopback-deep-agent-provider.ts`
   * 让 run 走到真实 `error` 终态，而不是本地伪造一个失败态组件。
   */
  deepAgentFailureTrigger: "取证：请让这次执行失败",
  /** UI 评分第 8 项取证：替身对这句回 markdown 正文（标题/列表/代码块），
   * 渲染路径是真实生产代码——给渲染器喂已知输入，不是伪造输出。 */
  deepAgentMarkdownTrigger: "取证：请用 markdown 展示能力",
  /**
   * UI 评分第 4 项取证（真实多步能力）：替身对这句回一条**多步依赖链**剧本——
   * write_todos → search_documents → read_document（第二个工具的 args 可见地引用
   * 第一个工具的结果）→ 终稿。评分员两轮都因「只有单个工具调用块、看不到
   * 调用→看结果→下一步的链条」无法给分；这条剧本让链条在 UI 上可判。
   * 与 `deepAgentMarkdownTrigger` 同一套接线：唯一事实源在本文件，
   * `playwright.chat-read.config.ts` 下发给替身进程。
   */
  deepAgentMultiStepTrigger: "取证：请展示多步执行",
  /**
   * 路径矩阵 **F5 / C8** —— 子任务那次模型调用要挺过多少次状态轮询才终态。
   *
   * 这个数字**必须**同时满足两个方向，写在这里是为了让它可被算清（矩阵 F3 的教训：
   * 两层各自都对、窗口乘起来是 0）：
   *
   * · **够长** —— 从「父 run 派发出子任务」到「测试点下取消、取消传到子任务」这段
   *   要落在窗口内。派发发生在父 run 的第一次模型往返里；子任务由 `SubtaskRunExecutor`
   *   的 tick 领走后才开始轮询，轮询周期是 provider 侧的状态轮询间隔。60 次留出的
   *   余量远大于「点一下取消 + 一次 250ms 的 watch 循环采样」。
   * · **有限** —— 没有取消时子任务会在这么多轮之后**正常完成**。F5 因此可以等过这个
   *   点再复查一次：「取消没传播」会以 `completed` / 有结果现形，而不是靠"它一直没
   *   完成"这种和"卡住了"分不开的弱信号。
   *
   * 见 `loopback-deep-agent-provider.ts` 的 `SUBTASK_HOLD_POLLS` 头注。
   */
  deepAgentSubtaskHoldPolls: 60,
  /**
   * issue #3000 —— 「这一轮真的跑一段时间」的触发词，只服务
   * `copilotkit-v2-run-restore-after-switch.spec.ts`：替身收到它之后先把 `/stream` 的
   * 响应头发出去、再等 `deepAgentSlowHoldMs` 才发正文，于是这一轮在切走/切回的整个
   * 过程中都真的停在 `running`（见替身 `SLOW_TRIGGER` 头注里的 trace 实测证据：借用
   * 多步触发词时这一轮 1.2 秒就跑完了，恢复路径一次都没被走到）。
   * 与其余触发词同一套接线纪律：唯一事实源在本文件，`playwright.chat-read.config.ts`
   * 下发给替身进程。
   */
  deepAgentSlowTrigger: "取证：请把这一轮慢慢跑完",
  /** 上面那条触发词的停留时长（毫秒）。同一份值下发给替身，用例不另写一份。 */
  deepAgentSlowHoldMs: 12_000,
  deepAgentScrollAcceptanceTrigger: "取证：请展示十步滚动验收",
  /**
   * UX-9 D4 前端接入取证（gap 清单第 3 条，「Edit, then continue」HITL 模式）：
   * 替身对这句触发词让 run 走真实 `awaiting_tool_permission`（`status: "interrupted"`），
   * 前端 `AgentApprovalPanel` 据此渲染待批工具 + 参数、可编辑 JSON 表单。
   * 唯一事实源在本文件，`playwright.chat-read.config.ts` 下发给替身进程，
   * 与 `deepAgentMarkdownTrigger`/`deepAgentMultiStepTrigger` 同一套接线纪律。
   */
  deepAgentApprovalTrigger: "取证：请触发人工审批",
  /**
   * issue #3132（B7）—— **计划确认门**的取证触发词。
   *
   * 替身收到它之后在 `/state` 里放一个**未配对**的 `write_todos` 工具调用（一份 3 步的
   * 提案计划）并回 `interrupted`，于是 run 真的落到 `awaiting_tool_permission`、
   * `pending_tool_name = write_todos` —— 与真实引擎被
   * `_write_todos_requires_plan_confirmation` 谓词拦下时逐字同形。
   *
   * ⚠ 为什么不复用 `deepAgentMultiStepTrigger`：那条剧本从不返回 `interrupted`，它
   * 演的是「计划已生效、正在逐步执行」。拿它去断言确认门，等于对着一个**结构上
   * 产不出该中断**的夹具要求一个中断——那正是 #3132 里「确认门永不渲染」被误读成
   * 「spec 有问题」的来源。两条剧本各演各的，不混用。
   */
  deepAgentPlanConfirmTrigger: "取证：请先确认计划再执行",
  /** 上面那条剧本提案计划的步骤数。>= 契约 `PLAN_CONFIRM_MIN_STEPS`（2）才会有门。 */
  deepAgentPlanConfirmSteps: 3,
  /**
   * issue #2919 —— 宽泛文档请求先补全主题与内容来源，再在同一个 run 上继续。
   * 这组值同时供浏览器断言、deep-agent loopback 剧本与 chat-read config 使用，
   * 避免三处各写一份触发词或产物名后静默漂移。
   */
  deepAgentClarificationTrigger: "生成中文 PDF",
  deepAgentClarificationTopic: "WorkspaceX Agent 工作台升级说明",
  deepAgentClarificationContentSource: "根据当前对话整理一页产品说明",
  deepAgentClarificationArtifactName: "WorkspaceX-Agent-工作台说明.pdf",
  /** issue #2919：三类结构化 HITL 必须都走同一持久 decision/resume 通路。 */
  deepAgentConfirmIntentTrigger: "取证：请确认任务意图",
  deepAgentChooseOptionTrigger: "取证：请让我选择执行方案",
  /**
   * 路径矩阵 B1/B4/B5/B6 —— **同一条 run 里连着中断两次**的剧本触发词。
   *
   * 人类 2026-09-10 在 devapp 上报的三个 HITL 缺陷（#3186 / #3207 / #3244 ①）全长在
   * 这个形状上，而此前**每一个**替身剧本都由「裁决一到就再也不中断」把关 ⇒ 这个形状
   * 在 e2e 上不可达，B 组因此全绿却一个都没抓住。值的唯一事实源在本文件，
   * 语义见 `loopback-deep-agent-provider.ts` 的 `TWO_INTERRUPT_TRIGGER` 头注。
   */
  deepAgentTwoInterruptTrigger: "取证：请连着中断两次",
  /** 第一次裁决之后、第二次中断之前的 hold 窗口（状态轮询次数）——见替身侧
   *  `TWO_INTERRUPT_HOLD_POLLS` 头注：这段窗口是**由构造撑开**的，不靠赛跑。 */
  deepAgentTwoInterruptHoldPolls: 8,
  /** 两次裁决都到齐之后的终稿正文——「run 真的走完了、没把用户锁死」的判据。 */
  deepAgentTwoInterruptFinalReply: "两次确认都已收到，任务按确认后的意图与资料执行完毕。",
  /** 第二次中断（`fill_run_params`）要填的那个字段的值。 */
  deepAgentTwoInterruptPersonaSource: "取证：来自当前会话的用户画像资料",
  /**
   * 路径矩阵 B4 —— **同一条 run 里连着请求两次技能授权**的剧本触发词（#3186 / #3212）。
   * 与上一条走的是另一条审批通路（四选一授权卡，不是具名表单中断），不能互相替代。
   */
  deepAgentTwoApprovalTrigger: "取证：请连着请求两次技能授权",
  /** 两次授权点名的技能不同——「用户看得出这次问的是哪个技能」才可证伪（#3212）。 */
  deepAgentTwoApprovalFirstSkill: "quarterly-report",
  deepAgentTwoApprovalSecondSkill: "persona-canvas",
  deepAgentTwoApprovalFinalReply: "两次技能授权都已收到，任务执行完毕。",
  /**
   * DA-19g —— 多轮上下文取证（chat-ux-acceptance-criteria.md 第 6 项）。替身对这句
   * 触发词逐字引用「这条线程上一次收到的用户消息」，命中的前提是 Chat 线程真的被续接
   * （`copilotkit-v2-panel.tsx` 回传 `forwardedProps.chatThreadId`）——没有续接就没有
   * 「上一轮」可引用，替身会如实说明"没有上文"而不是编造。唯一事实源在本文件，
   * `playwright.chat-read.config.ts` 下发给替身进程，与
   * `deepAgentMarkdownTrigger`/`deepAgentMultiStepTrigger` 同一套接线纪律。
   */
  deepAgentFollowupContextTrigger: "取证：还记得我上一句说的是什么吗",
  /** 替身命中上面那句触发词时，回复正文的前缀——与 `retrievalEchoPrefix` 同一套惯例。 */
  deepAgentFollowupContextEchoPrefix: "[remembered:]",
  /**
   * #728 P8 —— 麦克风实时转录取证。与 `fullstack-smoke-fixture.ts` 的
   * `asrTranscriptPrefix` 同一套惯例：确定性上游回一个带前缀的转录文本，
   * 断言方（这里是取证脚本自己，肉眼加截图）能确认转录确实来自这个进程，
   * 不是编造的。
   */
  asrTranscriptPrefix: "[loopback-asr]",

  /* ══════════ #1310 —— agent / skill / context 主流程 e2e 的种子与取证约定 ══════════ */

  /**
   * F65 要挂载的那个**已启用** skill。
   *
   * ⚠ #1559 起种在 **wave2 的 `skills`/`skill_versions`/`skill_version_files`（模型 A）**，
   *   不再是 `skill_contracts`（模型 B）。这里原来写着「种进 wave2 表会出现在选择器里
   *   却挂不上」——那句话在 #1534（挂载判据改走两套都查的 `loadMountableRow`，
   *   并把只认模型 B 的那个外键整个删掉）之后已经不成立。而**运行时只读模型 A**，
   *   所以只有种成模型 A，「挂了个 skill 对模型有没有影响」这条反证才可能成立。
   *   理由全文见 `seed-chat-read-e2e.ts` 里这块种子的头注。
   *
   * `org-wide`：`loadMountableRow`/`listAll` 对 wave2 行恒按 org-wide 判定（那两张表里
   * 没有可见范围列），本夹具用户 `addOrgMember(..., "lead", null)` 不属于任何团队，
   * 正好可见；本夹具也没有 `skill-create-smoke.spec.ts` 那条「目录空态」断言要保护。
   */
  mountableSkillId: "skill-chat-read-e2e-mountable",
  mountableSkillName: "假设拆解（E2E）",
  /**
   * #1559 —— 只出现在上面那个 skill 的 `SKILL.md` 正文里的哨兵串，全仓别处零命中。
   *
   * 「挂载的 skill 真的进了模型输入」这条反证的**全部**依据：确定性上游
   * (`loopback-model-provider.ts`) 只在自己收到的 **system prompt** 里真的看到它时，
   * 才把 `mountedSkillEchoPrefix + 哨兵` 写进回复。链上任何一环断掉——挂载没进 run 快照、
   * `readPinnedSkills` 读不回正文、`buildSystemPrompt` 没拼进去——哨兵都不会出现，
   * 断言如实红。
   *
   * ⚠ 刻意与 `retrievalTerm` / `retrievalDecoyQuery` / 本夹具其余用例发送的文本零重叠：
   *   任何重叠都会让它在别的用例的回显里冒出来，把这条反证变成恒绿。
   */
  mountedSkillSentinel: "MOUNTPROOF-9317",
  /** 上游把哨兵回显进回复时用的前缀，惯例同 `agentReplyPrefix` / `retrievalEchoPrefix`。 */
  mountedSkillEchoPrefix: "[skill:]",

  /**
   * F155 的检索素材：一份 `extraction_status='extracted'` 的聊天附件。
   *
   * ⚠ `retrievalTerm` 与 `retrievalDecoyQuery` 必须**零 token 重叠**，这是反向对照成立的前提。
   *   `pg-file-retrieval.ts` 把 `plainto_tsquery` 的 AND 改成了 **OR**，任何一个共同词都会
   *   让「不该命中」的那条命中，反向对照就退化成一条永远绿的断言。同理，正文用词刻意避开
   *   本夹具其余用例发送的文本（"Browser durable message" / "thinking indicator please" 等），
   *   免得那些用例的回复里冒出本条测试的来源标记。
   */
  retrievalAttachmentFilename: "zephyr-7742-cutover.md",
  retrievalTerm: "ZEPHYR-7742",
  retrievalExcerpt:
    "ZEPHYR-7742 cutover runbook. Rollback window: 40 minutes. Owner: platform guild. "
    + "Blast radius limited to the ZEPHYR-7742 shard; no cross-shard writes during cutover.",
  /** 一条与上面那份附件零 token 重叠的提问——用作「没召回」的反向对照。 */
  retrievalDecoyQuery: "如何给盆栽浇水",

  /**
   * 确定性上游替身在「history 里真的收到了 L3 检索伪消息」时，回显进回复的前缀。
   * 与 `agentReplyPrefix` / `asrTranscriptPrefix` 同一套惯例：唯一事实源在本文件，
   * 由 `playwright.chat-read.config.ts` 同时下发给替身进程与断言方。
   */
  retrievalEchoPrefix: "[retrieved:]",

  /* ══════════ #1324 —— #1310/#1314 的复核重构：三条独立线程，零预置历史 ══════════
   *
   * 复核意见：原来那条 27 秒大用例把三件不同的事（挂载持久化 / 因果链 / 检索命中对照）
   * 全压在 `threadId` 那条 51 条消息的共享夹具上，任何一条失败都要靠翻页才能定位。
   * 这里给每一条关注点各自一条**零预置消息**的专属线程——发出去的第一条消息天然
   * 落在第一页，不需要 `chat-messages-load-more`，失败定位不再依赖翻页。
   *
   * 三条线程共用同一个已发布、可运行的 `agentId`（`chat_thread_agents` 已种为
   * `present`），选择器不需要额外一步「加进编制」。
   */
  /**
   * ⚠ 三条线程放在**独立的第二个项目**里，不放进 `projectId` 那个项目——
   *   `chat-read.spec.ts:41` 有一条显式断言「这个项目只有一条会话」（`chat-thread-card-list`
   *   数出恰好 1 个按钮），注释原话「夹具里只有一条会话，列表就只列一条」；本轮实测过
   *   把三条线程直接塞进同一个项目，那条断言从 1 变 4，8/9 号断言收窄逻辑无关——是
   *   本次改动真的破坏了那条不变量。放到独立项目，两边互不相扰，不需要碰
   *   `chat-read.spec.ts` 那条断言本身。同一个 org、同一个已发布 agent、同一批
   *   org-wide 的 `capability_listings`（agent 目录）与 skill 依旧全部可见——
   *   这两样都不是项目范围的。
   */
  restructureProjectId: "project-chat-read-e2e-restructure",
  /** 只验 F65（挂载 → 角标 → 刷新仍在）的专属线程，不发任何消息。 */
  skillMountThreadId: "thread-chat-read-e2e-skill-mount",
  /**
   * #1322 因果对照的专属线程：挂载前后各发一条消息，比较各自那次 run 的
   * `skillVersionIds`。**当前诚实结论是两次相等（`[]`）**——挂载不影响 run，
   * 这是 #1322 记录的真实产品缺口，不是本条测试的 bug。
   */
  causalCheckThreadId: "thread-chat-read-e2e-causal-check",
  /**
   * context 命中/未命中对照的专属线程。F155 的检索附件（见下面 `retrievalAttachmentFilename`
   * 等字段）现在种在**这条**线程上，不再种在共享的 51 条消息 `threadId` 上——那条线程
   * 从未有任何其它用例依赖这份附件，移过来不影响 `chat-read.spec.ts` 的既有断言。
   */
  contextCheckThreadId: "thread-chat-read-e2e-context-check",

  /* ══════════ #1560 P1 e2e —— 图片附件走 VLM 视觉理解，无 key 时的诚实降级路径 ══════════
   *
   * 本机（以及本条 e2e 链路）没有真实的百炼视觉 key——上游换成 `loopback-vision-provider.ts`
   * 这个确定性替身，它对任何请求都如实回「key 无效」（401 `InvalidApiKey`），与
   * `bailian-vision-extractor.ts` 的 `classifyHttpFailure` 判定 `visionNotConfigured` 的
   * 那一支代码路径完全对齐。这条测试证的是**诚实降级**：图片上传仍 201，抽取管线真被
   * 触发、真走到 `failed` 终态，而不是「识图真的成功了」（那需要真实上游 key，本仓不做）。
   */
  imageVisionThreadId: "thread-chat-read-e2e-image-vision",

  /**
   * #1584 e2e —— 附件预览/下载弹窗的专属线程。曾经复用 `imageVisionThreadId`，单独跑
   * 这个 spec 文件没问题，但 `verify:chat-read` 整套跑起来时两个 spec 共写同一条线程，
   * 各自按 message id 定位到的那一行读出了混着对方文本的内容——同一套「独立线程零预置
   * 消息」的道理，见上面 #1324 三条线程的头注。
   */
  attachmentPreviewThreadId: "thread-chat-read-e2e-attachment-preview",
  /**
   * issue #1610 —— `chat-diagram-save-reopen-roundtrip.spec.ts` 的专属线程。
   *
   * 该 spec 此前复用共享的 `threadId`（`chat-read.spec.ts` 也依赖的那条 51 条消息
   * 夹具线程），并在上面真实落地产物（`POST /chat/threads/:threadId/artifacts`）。
   * `playwright.chat-read.config.ts` 是 `fullyParallel: false` 单 worker、跨 spec 按
   * 字母序串行执行——`chat-diagram-save-reopen-roundtrip.spec.ts` 字母序排在
   * `chat-read.spec.ts` 之前，它落地的产物卡会撑高共享线程的消息区总高度，让
   * `chat-read.spec.ts:4`「发消息后自动滚到底（distanceFromBottom<=80）」那条断言
   * 是否变红取决于两个 spec 之间的执行时刻间隔——这是一场侥幸通过的时序竞态，不是
   * 真正的隔离（本轮实测复现：字母序间插入新 spec 文件、拉长间隔后断言稳定变红，
   * `Received: 184`，详见 issue 正文）。
   *
   * 修法与上面 `attachmentPreviewThreadId` 等专属线程同一套 #1324 起确立的惯例：
   * 给它一条独立的、放在 `restructureProjectId`（不是 `projectId`，理由同上面
   * #1324 三条线程头注——`chat-read.spec.ts:41` 断言 `projectId` 下只有一条会话）
   * 下的专属线程，零预置消息——该 spec 的两条用例都会自己先发一条消息种画像素材，
   * 不依赖任何预置历史，也不需要 `chat-messages-load-more` 分页。
   */
  diagramRoundtripThreadId: "thread-chat-read-e2e-diagram-roundtrip",
  /* ══════════ context-engine 浏览器 e2e（L2 滚动摘要 + F190 工具轨迹回喂）══════════
   *
   * 与上面几条专属线程同一套理由：各自独立、不共享其它用例的历史，唯一不同是这两条
   * **不是**零预置消息——L2/F190 都要求"早期内容已经被挤出 L1 近端窗口"这个前提成立，
   * 零预置消息的空线程测不出这件事，所以种子脚本会为这两条线程各自灌入足够多的撑满
   * 字符预算的填充消息（同 `apps/api/tests/chat/agent-run-context-snapshot.test.ts`
   * 与 `tool-trace-cross-run-context.test.ts` 两份真库单测用的 `pad()` 手法，只是这次
   * 要让真实浏览器发的那一条消息去触发它，不是在单测里直接调 `executeQueuedRuns`）。
   */

  /* ══════════ F05 —— chat 键盘可达性专属线程 ══════════
   *
   * 同上面几条专属线程一套理由：独立、零预置消息，不与别的 spec 共写。放在
   * `restructureProjectId` 而不是 `projectId`——`chat-read.spec.ts:41` 断言
   * `projectId` 下只有一条会话，塞进去会把那个数字从 1 顶成 2。这里放两条
   * （不是一条）：键盘走查的核心任务之一是"切换到另一个会话"，需要至少两条
   * 已存在的会话可以切换，不能靠现拼一条新会话来测（那样测的是"新建"，不是"切换"）。
   */
  keyboardThreadAId: "thread-chat-read-e2e-keyboard-a",
  keyboardThreadBId: "thread-chat-read-e2e-keyboard-b",

  /** L2 滚动摘要检查线程：种了足够多填充消息，把下面这条"早期事实"挤出 L1。 */
  l2CheckThreadId: "thread-chat-read-e2e-l2-check",
  /** 埋在 L2 检查线程最早一条消息里的代号——只有 L2 摘要真的覆盖到它才可能间接留痕。 */
  l2EarlyFactCodeWord: "MERLIN7734",
  /**
   * 确定性上游在 history 里看到 L2 摘要伪消息（`execute-run.ts` 拼的
   * `[早前对话摘要] ...` 前缀）时，回显进回复的前缀。与 `retrievalEchoPrefix` 同一套
   * 惯例：唯一事实源在这里，由 `playwright.chat-read.config.ts` 同时下发。
   */
  l2SummaryEchoPrefix: "[l2-summary-seen:]",

  /** F190 工具轨迹检查线程：种了一轮"历史工具调用"+ 足够多填充消息把它挤出 L1。 */
  toolTraceCheckThreadId: "thread-chat-read-e2e-tool-trace-check",
  /** 那轮历史工具调用记录的工具名。 */
  toolTraceHistoricalToolName: "lookup_incident_code",
  /** 那轮历史工具调用的结果摘要里嵌的代号——回喂进下一轮 history 才会出现在回显里。 */
  toolTraceHistoricalResultCode: "GRIFFIN2201",
  /**
   * 确定性上游在 history 里看到工具轨迹回喂伪消息（`tool-trace-context.ts` 拼的
   * `[近期工具调用记录` 前缀）时，回显进回复的前缀。
   */
  toolTraceEchoPrefix: "[tool-trace-seen:]",

  /* ══════════ 5 点迭代要求第②条 —— 真实生产 chat「基于上下文生成可视化」 ══════════
   *
   * 与「后台 chat 模拟」（`canvas-template-simulate-smoke.spec.ts`）验的是**两件不同的
   * 事**：那条走的是模拟专用只读端点 `POST /canvas/templates/:key/simulate`，不经过
   * `execute-run.ts`/`buildCanvasTemplateGuidance` 这条真实 agent-run 注入链路；这里要
   * 验的是人类要求的「前端 chat」——真实发一条消息，真实 `execute-run.ts` 把已发布模板
   * 的指引拼进 system prompt，模型（确定性替身）真的看到它、产出围栏，前端真实渲染成
   * `ChatCanvasFabric`。两条链路在生产代码里完全不共享执行路径，一条绿不能替另一条作证。
   *
   * 种子脚本（`seed-chat-read-e2e.ts`）走与 `backfill-canvas-builtin-templates.ts` 相同的
   * 「真实 create/publish 用例，不裸 INSERT」纪律，见该脚本本节头注。
   */
  /** 独立线程，零预置消息，不与别的用例共写（同上面每一条专属线程的既有理由）。 */
  canvasGuidanceThreadId: "thread-chat-read-e2e-canvas-guidance",
  /** 种进本夹具组织、发布状态的画布模板 key——唯一事实源，种子脚本与断言方共用。 */
  canvasTemplateKey: "chat-read-e2e-canvas",
  canvasTemplateDisplayName: "会话画布验收模板",
  /** 表头字段（`type: "短文本"` 分区）中文名，格式见 `buildCanvasTemplateGuidance` 的 `字段名: 字段值`。 */
  canvasHeaderFieldName: "姓名",
  /** 正文分区（便利贴列表）中文名，格式见 `buildCanvasTemplateGuidance` 的 `## 分区名`。 */
  canvasSectionName: "要点",
  /**
   * issue #2295 —— `buildCanvasTemplateGuidance` 把组织下**全部**已发布模板列进该组织
   * **每一条线程、每一次 run** 的 system prompt，原判定只查 system prompt 里有没有
   * `CANVAS_GUIDANCE_HEADER` + 模板 key 这两个信号，在本夹具组织种下这一个已发布模板后
   * 对同组织其余 10 条用例的请求恒为真，把它们的 `fullText` 整体顶成画布围栏。
   *
   * 这个哨兵只出现在 `chat-canvas-guidance-render.spec.ts` 发的那一条用户消息正文里
   * （全仓别处零命中，同 `mountedSkillSentinel` 一套隔离纪律），由
   * `playwright.chat-read.config.ts` 下发给 `loopback-model-provider.ts` 的
   * `canvasGuidanceReachedModel`，作为「这次请求确实来自那条专属画布线程」的第三个
   * 判定信号——前两个 system prompt 信号继续保留，证明的是注入链路本身；这个哨兵证明
   * 的是这次请求的范围，不是替代前两者。
   */
  canvasGuidanceSentinel: "E2E-CANVAS-GUIDANCE-6031",

  /* ══════════ 路径覆盖矩阵（`.harness/instructions/chat-path-coverage-matrix.md`）══════════
   *
   * 下面这一组只服务 `chat-path-*.spec.ts` 那批新增用例——把矩阵里此前**零覆盖**的
   * 路径逐条转成可判定的断言。每一条的纪律与上面每一组逐字相同：唯一事实源在本文件，
   * `playwright.chat-read.config.ts` 同时下发给种子脚本与确定性替身，断言方引用同一个
   * 常量，三处不各写一份。
   *
   * ⚠ 这批用例跑在**独立 project 车道** `chat-path-coverage` 上（同 config、同一套已经
   *   起好的 webServer，只切 testMatch），不在阻塞 `e2e-full` 的 `chat-read` 车道里——
   *   理由与 issue #2114 摘出记分牌车道那次逐字相同，见该 config 对应段落。
   */

  /**
   * A3 长会话压缩 —— 早期事实**穿过压缩层活下来**。
   *
   * 与 `context-engine.spec.ts` 那条 L2 断言不是同一件事，也不是它的副本：那条证的是
   * 「摘要伪消息这个**结构**真的到达了模型输入」（`l2SummaryEchoPrefix`），压缩把内容
   * 丢光了它照样绿；这条证的是「被挤出 L1 的那个**具体事实**（`l2EarlyFactCodeWord`）
   * 真的还在摘要正文里」。结构在 ≠ 事实在，这正是长会话压缩唯一会伤到用户的失效形态。
   */
  l2FactEchoPrefix: "[l2-fact-seen:]",

  /**
   * C4 一次生成两个画布 —— 第二个哨兵。
   *
   * 哨兵是**第二个**、不是替换：`canvasGuidanceSentinel` 继续作为「这次请求确实要走
   * 画布分支」的判定信号，`canvasDualSentinel` 只多说一句「这一轮要两个围栏」。
   *
   * ⚠ 这里**没有**专属线程：当时 v2 上切 agent 会重挂面板并开一条新对话（issue
   * #3028，**2026-09-08 已修**），深链进一条种好的线程再切 agent 拿到的其实是另一条
   * 空线程。C4/C5 不需要历史，这条「用新建线程」的选择在修复后依然成立，保持不动。
   * 画布指引只依赖「组织有
   * 已发布模板」+「用户正文里带哨兵」，与线程是谁无关，所以 C4/C5 用**新建线程**，
   * 天然与别的用例隔离。曾经种过的两条专属线程随之删掉——留着就是没人用的死夹具。
   */
  canvasDualSentinel: "E2E-CANVAS-DUAL-4417",

  /**
   * D4 skill 三态 —— 「目录里看得见它」这一态的回显前缀。
   *
   * `buildDeepAgentSkillCatalogBlock` 只把 `stable_name + 一行摘要` 放进 system prompt，
   * 全文经 `config.configurable.org_skills` 送达（`mountedSkillSentinel` 那条判据）。
   * 两者是**两个不同的信号**，此前只有后者被断言过——一个把目录条目当成「正文到了」的
   * 实现会全绿。这个前缀让前者单独可观察，三态才谈得上区分。
   */
  mountedSkillCatalogEchoPrefix: "[skill-catalog-seen:]",
  /**
   * 那条可挂载 skill 的 `stable_name`。此前只写死在 `seed-chat-read-e2e.ts` 里，
   * 断言方无从引用——D4 要在替身收到的目录块里找的正是这个字符串，于是它必须是
   * 单一事实源（本仓「同一事实不得声明在两处」那条纪律）。
   */
  mountableSkillStableName: "chat-read-e2e-hypothesis-tree",

  /**
   * F7 上游断流 —— 触发词命中时，确定性 deep-agent 替身在 `/stream` 上先正常发几片
   * 正文，然后**直接销毁 socket**（不是回一个规整的错误终态：那条路径已由
   * `deepAgentFailureTrigger` + `copilotkit-v2-error-banner.spec.ts` 覆盖）。
   * 要证的是「上游半路断了，界面诚实收场，不假装还在跑」。
   */
  deepAgentStreamAbortTrigger: "取证：请在流式过程中断开上游",
} as const;
