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
   * UX-9 D4 前端接入取证（gap 清单第 3 条，「Edit, then continue」HITL 模式）：
   * 替身对这句触发词让 run 走真实 `awaiting_approval`（`status: "interrupted"`），
   * 前端 `AgentApprovalPanel` 据此渲染待批工具 + 参数、可编辑 JSON 表单。
   * 唯一事实源在本文件，`playwright.chat-read.config.ts` 下发给替身进程，
   * 与 `deepAgentMarkdownTrigger`/`deepAgentMultiStepTrigger` 同一套接线纪律。
   */
  deepAgentApprovalTrigger: "取证：请触发人工审批",
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
} as const;
