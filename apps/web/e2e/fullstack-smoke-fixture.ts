const scope = (process.env.WORKSPACEX_ISOLATION_ID ?? "fullstack-e2e")
  .replace(/[^a-zA-Z0-9-]/g, "-")
  .slice(-24);

export const FULLSTACK_E2E = {
  email: `fullstack-${scope}@example.test`,
  password: "Fullstack-E2E-only-387!",
  orgId: `org-fullstack-${scope}`,
  userId: `user-fullstack-${scope}`,
  projectId: `project-fullstack-${scope}`,
  artifactId: `artifact-fullstack-${scope}`,
  projectName: `Fullstack sentinel project ${scope}`,
  sentinelFile: `FULLSTACK_SENTINEL_${scope}.md`,

  /**
   * #458：Agent 目录的写路径需要一个**组织管理员**。
   *
   * ⚠ 刻意是第二个账号，而不是把上面那个改成 admin。上面那位是 `consultant`，
   *   #387 的整条 projects / Files 断言都建立在他那份权限上；为了 #458 顺手升权，
   *   等于让另一个门控在一个它没测过的角色上跑——而它会**照样全绿**，
   *   直到某天有人发现「非管理员能看见什么」这条根本没人再验过了。
   */
  adminEmail: `fullstack-admin-${scope}@example.test`,
  adminPassword: "Fullstack-E2E-admin-458!",
  adminUserId: `user-fullstack-admin-${scope}`,

  /**
   * #458 自己的非管理员，**不复用上面那位 consultant**。
   *
   * Playwright 按文件并行（两个 worker），两个 spec 同时用同一个账号登录会撞上设备会话——
   * 本仓已经有 `kick-device-invalidates-session` 那条行为，同一账号的并发登录**可能**互相踢掉。
   * 那种失败是间歇性的，最后会被归因成「e2e 不稳」然后被人加重试掩盖过去。
   * 一个多出来的种子账号比一条会偶发的门控便宜得多。
   */
  memberEmail: `fullstack-member-${scope}@example.test`,
  memberPassword: "Fullstack-E2E-member-458!",
  memberUserId: `user-fullstack-member-${scope}`,
  /** 新建出来的 Agent 名字。带 scope，避免与并发隔离出来的其它库互相看见。 */
  agentName: `FULLSTACK_AGENT_${scope}`,

  /**
   * 🟡 #496：核心闭环第 4 步「新增可视化模板」在浏览器里真的建出来的那一个。
   *
   * ⚠ key 只用 `[a-z0-9-]`：它进 URL（`/canvas/templates/:key/publish`），
   *   而 scope 已经被上面那个 `replace` 洗过一遍，这里不再洗第二遍。
   * ⚠ 反证用的 key 与正例**不同**：同一个 key 会撞上 `TEMPLATE_KEY_CONFLICT`，
   *   于是反证那条会因为「409」而红——红了，但**不是因为对的原因**。
   */
  canvasTemplateKey: `tpl-496-${scope}`.toLowerCase(),
  canvasTemplateName: `FULLSTACK_TEMPLATE_${scope}`,
  canvasTemplateCounterproofKey: `tpl-496-cp-${scope}`.toLowerCase(),
  canvasTemplateCounterproofName: `FULLSTACK_TEMPLATE_CP_${scope}`,

  /**
   * #520：核心闭环第 3 步「新增 Skill」在浏览器里真的建出来的那一个。
   *
   * ⚠ 反证用的名字与正例**不同**：`createSkillDraft` 撞名会被
   *   `skill.controller.ts:353 rejectNameConflict` 判 409，于是反证那条会红——
   *   红了，但**不是因为对的原因**（#496 在同一处踩过，原文见上面那段）。
   */
  skillName: `FULLSTACK_SKILL_${scope}`,
  skillCounterproofName: `FULLSTACK_SKILL_CP_${scope}`,

  /**
   * 🟡 #493：核心闭环第 8c 步「**使用**一个 canvas 模板」的两个前置条件。
   *
   * ⚠ 种的是**前置条件**，绑定动作本身一行都不种（`canvas_template_bindings` 刻意为空）——
   *   与 #467 种「已启用的 skill」、#435 种「可运行的 agent」完全同型。所以 8c 在
   *   「绑定没生效」时照样红：`usageCount` 会停在 0。
   *
   * ① **一个 `published` 模板**。`bindTemplateToSegment` 的判定
   *    （`domain/canvas/segment-binding.ts`）只接受 `published`，而闭环第 4 步建出来的是
   *    **草稿**；发布它要 org admin，用它要项目引导师——两个身份刻意不是同一个人
   *    （`bind-template-to-segment.ts` 文件头逐字写了为什么）。让 8c 自己切两次账号先发布，
   *    等于把「使用模板」这条断言压在「发布模板」的成败上。
   *    ⚠ **`team-only`（归 `fullstack` 团队），不是 `org-wide`** —— 与上面 #467 那条 skill
   *      种子逐字同一个理由：`canvas-template-create-smoke.spec.ts:87` 断言**管理员**打开
   *      模板库时 `tpladmin-empty` 可见，那是一条反空转断言，不许为了塞这条种子而放宽。
   *      管理员不属于任何团队 ⇒ 这一行对他不可见；对本项目的引导师（team=fullstack）可见。
   *      实测：先写成 `org-wide`，那条断言当场红。
   *
   * ② **一个 `active` 的议程环节**，绑定的落点。
   *    ⚠ 与 #467 那条「没有任何产品路径能启用一个 skill」逐字同型的**真实缺口**：
   *      `createAgendaSegment` 在契约里（`project.operations.createAgendaSegment`），
   *      却**没有任何 controller 挂它**——全仓写 `agenda_segments` 的地方只有测试夹具。
   *      ⇒ 今天没有任何产品路径造得出一个议程环节。缺口随 #493 上报；在它补上之前，
   *      8c 能验的是「把模板用到环节上」这条链路本身，验不了「用户自己造出那个环节」。
   *      **不得**为了绕开它去放宽 `bindTemplateToSegment` 的环节存在性判定。
   *    ⚠ `active` 而不是 `pending`：`GET /projects/:id/overview` 只回**当前**环节
   *      （`pg-project-overview-repository.ts` 逐字 `WHERE state = 'active'`），
   *      那是界面上唯一有真实来源的环节。I-P44 的部分唯一索引允许每工作坊一条 active。
   */
  boundTemplateKey: `tpl-493-${scope}`.toLowerCase(),
  boundTemplateName: `FULLSTACK_BINDABLE_TEMPLATE_${scope}`,
  agendaSegmentId: `seg-493-${scope}`,
  agendaSegmentTitle: `闭环 8c 环节`,

  /**
   * 🟡 #467：核心闭环第 8a 步挂载的那个 skill，**必须是「已启用」的**。
   *
   * ⚠ 这里种的是「本组织有一个可用的 skill」这个**前置条件**，与 #435 种
   *   `agents` / `org_agents` 完全同型 —— 挂载与卸载这两个动作本身由用例现场做，
   *   一个都没有预置（`thread_skill_mounts` 刻意不种）。断言因此仍然会在
   *   「挂载没生效」时红。
   *
   * ⚠ **为什么不能让用例自己把它建成「已启用」**：`skill.controller.ts` 逐字
   *   没有启用路由（`SKILLS_FORBIDDEN_ROUTES` 禁止 `POST /skills/:id/enable`），
   *   `草稿 → 已启用` 只能由 `reviewSkillVersion` 的 approve 分支产生，而那条用例
   *   **今天没有 HTTP 边界**（#459 明确移出范围）。⇒ 这套系统里目前**不存在**
   *   任何产品路径能把一个 skill 变成「已启用」。这是一个**真实缺口**，
   *   已随 #467 上报；在它补上之前，第 8a 步能验的是挂载/卸载这条链路本身，
   *   验不了「用户自己造出一个可挂载的 skill」。**不得**为了绕过它去放宽
   *   `mountSkillToThread` 的 `SKILL_NOT_ENABLED` 判定。
   *
   * ⚠ 它是 **`team-only`（归 `fullstack` 团队）**，不是 `org-wide`：管理员不属于任何
   *   团队，而管理员**不是**超级用户，所以 `skill-create-smoke.spec.ts:94` 那条
   *   「管理员打开目录看到真实空态」的反空转断言原样成立。理由全文见
   *   `apps/api/scripts/seed-fullstack-smoke.ts` 里同一段种子的注释。
   */
  mountableSkillId: `skill-467-${scope}`,
  mountableSkillName: `FULLSTACK_MOUNTABLE_SKILL_${scope}`,

  /**
   * 🟢 #435：核心闭环第 8b 步真正**跑得起来**的那个 Agent。
   *
   * ⚠ 「能跑」与「在编制面板里看得见」在本仓是**两个互不相交的世界**，
   *   种子必须两边都写，否则 8b 会以两种完全不同的方式失败：
   *
   *     可运行  ← `agents` + `agent_versions`（status='enabled'、published_at 非空）
   *              ← `pg-chat-message-command-repository.ts:159-190` 只读这两张表；
   *                缺了它 → `POST …/messages` 返回 422 `AGENT_NOT_FOUND`。
   *     可选中  ← `org_agents`（+ 线程级 `chat_thread_agents`）
   *              ← `pg-chat-repository.ts:343-361` 的编制面板只读这两张表；
   *                缺了它 → 下拉框是「没有可选 Agent」，发送按钮恒灰。
   *
   *   两张网都不 JOIN 对方，所以「目录里有」既不蕴含「能跑」，也不蕴含「看得见」。
   *   线程是用例现场新建的，`chat_thread_agents` 没法预种——由用例走
   *   `chat-roster-add-*` 把它挂进编制，那一步同时也验证了 `updateAgentRoster` 的
   *   `org_agents` 作用域检查（`pg-chat-repository.ts:396-402`）。
   */
  agentId: `agent-fullstack-${scope}`,
  agentDisplayName: `FULLSTACK_RUNNABLE_AGENT_${scope}`,
  /**
   * ⚠ 这个字面量必须与 `playwright.fullstack-smoke.config.ts` 下发给 API 的
   *   `KERNEL_MODEL_PROVIDER` **逐字相同**。`ConfiguredModelProvider` 拿 run 快照里
   *   钉住的 `model_provider` 与配置值做**全等比较**，不等就
   *   `MODEL_PROVIDER_NOT_CONFIGURED`（`configured-model-provider.ts:66-73`）——
   *   那是设计如此，不是 bug：它保证了「没有第二个 provider 能悄悄接管一次 run」。
   *   所以这里只留**一份**字面量，两边都从它取。
   */
  agentModelProvider: "fullstack-loopback",
  agentModelId: "loopback-echo",
  /** 回显前缀，与 `apps/api/scripts/loopback-model-provider.ts` 的 `REPLY_PREFIX` 同源。 */
  agentReplyPrefix: "[loopback]",

  /**
   * 🟡 #466：核心闭环第 7 步「会话内录音」用的那条线程。
   *
   * ⚠ **为什么它必须预置，而第 6a / 8a 步的线程是现场建的**：录音的授权矩阵
   *   （`recording_consent_cells`）按 `source_ref_id` 存，而契约里**没有任何**
   *   写授权格子的操作 —— 这套系统今天不存在任何产品路径能完成录音授权
   *   （与 #467「没有路径能启用 skill」同型，已随 #466 上报）。现场新建的线程 id
   *   在种子跑的时候还不存在，所以授权无从预置。⇒ 线程与授权只能一起种。
   *
   * ⚠ **录音本身一行都不种**：`recording_sessions` / `recording_tracks` /
   *   `recording_segments` 全部由用例现场走真实链路产生。所以「开始录音没生效」
   *   或「转录没落库」时第 7 步照样红 —— 种的是前置条件，不是被断言的东西。
   */
  recordingThreadId: `thread-466-${scope}`,
  recordingThreadTitle: `FULLSTACK_RECORDING_THREAD_${scope}`,

  /**
   * 🟡 #466：确定性 ASR 上游回显的转录前缀。
   *
   * 与 `agentReplyPrefix` 同一条纪律：唯一事实源在这里，由
   * `playwright.fullstack-smoke.config.ts` 同时下发给
   * `apps/api/scripts/loopback-asr-provider.ts` 与断言方。那个进程回的是
   * `<前缀> <真实收到的 PCM 字节数>` —— 字节数是**音频真的从浏览器流过来了**
   * 的证据；少了它，断言在「前端自己合成一段文字」时照样绿。
   */
  asrTranscriptPrefix: "[loopback-asr]",
} as const;
