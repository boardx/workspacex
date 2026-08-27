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

  /**
   * PJ-01 / #976：组织角色 `lead` 的那一位 —— **新建项目唯一有权的角色**。
   *
   * ⚠ 为什么必须是第五个账号，而不是复用上面任何一位：
   *   · 上面那位 consultant 与 member 都不是 `lead`，`createProject` 对他们判
   *     `ORG_ROLE_INSUFFICIENT`（契约 U-4）；
   *   · admin **也不能建项目**（U-4 已裁 A，与 D-18「管理员不是超级用户」同向）。
   *     把 admin 升成 lead 顺手用掉，等于把那条已裁决的边界从种子里抹掉，
   *     而抹掉之后所有门控**照样全绿**——那正是本仓九次「全绿但空转」的形状。
   *   · 并发登录会互相踢设备会话（见上面 member 那段），所以不与别的 spec 共用账号。
   *
   * 正因为 consultant 不是 lead，`project-create-smoke.spec.ts` 用他做**反证**：
   * 同一个界面动作换成非 lead，必须在界面上看到 `ORG_ROLE_INSUFFICIENT`。
   */
  leadEmail: `fullstack-lead-${scope}@example.test`,
  leadPassword: "Fullstack-E2E-lead-976!",
  leadUserId: `user-fullstack-lead-${scope}`,
  /**
   * PJ-01 在浏览器里真的建出来的那个项目名。带 scope：并发隔离出来的其它库不会互相看见。
   * ⚠ 与种子预置的 `projectName`（sentinel project）是两个不同的名字 —— 同名的话，
   *   「列表里有这个项目」就分不清是我建出来的还是种子本来就有的。
   */
  createdProjectName: `PJ01_CREATED_PROJECT_${scope}`,
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
  /**
   * #988 / #1493：「基于此开新版」（mintTemplateVersion）的浏览器级门控用的那一条谱系。
   *
   * ⚠ **不用 #493 的 `boundTemplateKey`**：那条种子是 `team-only`（归 fullstack 团队），
   *   而这条门控用组织管理员登录——管理员不属于任何团队，看不见它（这正是
   *   `canvas-template-create-smoke.spec.ts` 管理员空态断言成立的原因）。也**不在种子里
   *   加一条 org-wide published 模板**：那会把同一条空态反空转断言当场打红。
   *   ⇒ 来源模板由用例自己在浏览器里建出来再发布（走的都是 #496 已门控的路径），
   *   然后对它开新版——链路一节不省，也不动种子。
   *
   * ⚠ key 只用 `[a-z0-9-]`（进 URL `/canvas/templates/:key/versions`）；与 #496 的
   *   两个 key 都不同——撞 key 会红在 `TEMPLATE_KEY_CONFLICT` 上，不是因为对的原因。
   */
  mintSourceKey: `tpl-988-${scope}`.toLowerCase(),
  mintSourceName: `FULLSTACK_MINT_SOURCE_${scope}`,
  /** 开新版时改掉的显示名——带 MINTED 前缀，断言「改过的名字」不会误配来源行。 */
  mintedDisplayName: `FULLSTACK_MINTED_V2_${scope}`,

  /**
   * chat 模拟（`TemplateSimulateDialog`，`POST /canvas/templates/:key/simulate`）的
   * 真实浏览器门控用来源模板——现场建、现场加一个短文本表头字段 + 一个便利贴列表
   * 正文分区，与 #496/#988 那两条同一条理由：不往种子里塞 published 行，避免打红
   * 管理员空态反空转断言。
   */
  canvasSimulateName: `FULLSTACK_SIMULATE_${scope}`,
  /** 反证用例的独立来源模板——不复用上面那个，避免两条测试互相踩同一行的编辑状态。 */
  canvasSimulateCounterproofName: `FULLSTACK_SIMULATE_CP_${scope}`,

  skillName: `FULLSTACK_SKILL_${scope}`,
  skillCounterproofName: `FULLSTACK_SKILL_CP_${scope}`,

  /**
   * 🟢 #552：**用户自己造出一个「已启用」skill** 这条链路要用的东西。
   *
   * ## 为什么这里多了一个账号
   *
   * I-5/V14 要求两评审职能**不合并**：安全评审人调用 `reviewSkillVersion` 必须拿到
   * `REVIEWER_FUNCTION_MISMATCH`。⇒ 这条断言需要一个**真的持有 `security-reviewer`
   * 职能**的人，而现成三个账号都不合适：
   *   · `email`（consultant，团队 fullstack）—— 本链路的**提交人**，种成方法论审核人，
   *     好让「自己审自己」落在 `SELF_REVIEW_FORBIDDEN` 上而不是「你根本没职能」上；
   *   · `memberEmail`（consultant，团队 fullstack）—— **第二位**方法论审核人，approve 的那位；
   *   · `adminEmail`（admin，**不属于任何团队**）—— 看不见 `team-only` 的 skill，
   *     用他做职能不匹配的断言会红在 404 上，**不是因为对的原因**。
   * ⇒ 多种一个团队 fullstack 的 consultant，专门持 `security-reviewer`。
   *
   * ## ⚠ 这两条 skill 只种到「草稿」——扫描 → 提交 → 批准仍是用例现场的事
   *
   * 与上面 `mountableSkillId`（#467 种的那条已启用 skill）**不同**：那条必须种到底
   * （已启用），因为当时不存在任何产品路径能启用一个 skill；而 #552 补的就是那条路径，
   * 所以**不**在这里把 `reviewedSkillName` 种到已启用——那会把被断言的结论预置掉。
   *
   * 这两行原来确实一行都不种（`createTeamOnlySkill` 走 `/skill` 的「完全新建」面板
   * 现场建）。**F192**（issue #598，2026-08-16 签核）冻结了那条面板与 `POST /skills`
   * （恒 410）之后，「现场建」这条路已经走不通了——不是这条 spec 的断言错了，是
   * 它依赖的创建入口被另一条 feature 关掉了。于是改为在这里把**草稿**（`skill_contracts`
   * `status='草稿'`、`skill_contract_versions` `state='草稿'`、`current_version_id`
   * 仍是 NULL）种进去，`created_by` 钉死为 `userId`（下面的提交人账号）——与 UI 面板
   * 原本会写出的行**同形**（对照 `pg-skill-contract-repository.ts` 的 `saveDraft`），
   * 只是换了写入路径，不改变「谁提交的」这个事实，所以「自己审自己 ⇒
   * `SELF_REVIEW_FORBIDDEN`」等断言不受影响。扫描 pass/reject、提交进人工门禁、
   * 第二评审人批准、安全评审人职能不匹配、批准后刷新仍是「已启用」——这些仍然全部
   * 走真实的 `SkillReviewController` HTTP 路径，一步都没有被种子代劳。
   *
   * ⚠ 建出来的是 **`team-only`（归 fullstack 团队）**，与 `mountableSkillId` 同一个理由：
   *   `skill-create-smoke.spec.ts:94` 断言**管理员**打开目录看到真实空态，那是一条反空转
   *   断言，不许为了本链路而放宽。管理员不属于任何团队 ⇒ 这两行对他都不可见。
   */
  securityReviewerEmail: `fullstack-secrev-${scope}@example.test`,
  securityReviewerPassword: "Fullstack-E2E-secrev-552!",
  securityReviewerUserId: `user-fullstack-secrev-${scope}`,
  /** 走完整条门禁、最终被批准成「已启用」的那一个。 */
  reviewedSkillName: `FULLSTACK_REVIEWED_SKILL_${scope}`,
  /**
   * 反证 C 用的那一个：**建出来就一直停在草稿**，从不提交、从不审核。
   * ⚠ 名字与上面那个不同 —— 同名会撞 `SKILL_NAME_CONFLICT`（409），
   *   于是反证会红，但**不是因为对的原因**（#496 / #520 都在这一处踩过）。
   */
  draftOnlySkillName: `FULLSTACK_DRAFT_ONLY_SKILL_${scope}`,

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
   *    ✅ **缺口已补（#627 / PR #645，2026-08-06）**：`createAgendaSegment` 现在有真实
   *      controller —— `POST /workshops/:workshopId/agenda-segments`
   *      （`apps/api/src/interface/controllers/project.controller.ts`）。
   *      ⇒ 用户**能**自己造出议程环节，这里预置只是为了让 8c 聚焦在「绑定」本身。
   *      历史（保留以便读懂当初为什么要种）：#493 上报时全仓写 `agenda_segments`
   *      的地方只有测试夹具，那时确实不存在任何产品路径。
   *      **不得**为了绕开环节存在性判定去放宽 `bindTemplateToSegment`。
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
   * ⚠ **为什么这里仍然预置，而不是让用例自己走一遍**：`skill.controller.ts` 至今
   *   没有、也不该有启用路由（`SKILLS_FORBIDDEN_ROUTES` 禁止 `POST /skills/:id/enable`）；
   *   `草稿 → 已启用` 只能由 `reviewSkillVersion` 的 approve 分支产生。
   *   ✅ **那条 HTTP 边界已经补上（#552 / PR #584，2026-08-05）**：
   *   `POST /skill-versions/:versionId/review`
   *   （`apps/api/src/interface/controllers/skill-review.controller.ts`），
   *   且按 I-5/V14 需要**第二评审人**。⇒ 用户**能**自己把 skill 推到「已启用」。
   *   这里继续预置的理由变成了成本：走完整评审要第二个身份，为 8a 一条用例引入
   *   双身份编排不划算。**这不再是产品缺口**——真要验「用户自建 skill 可用」，
   *   看 CLR track R 的 R8（`core-loop-readiness-standard.md`），别看这条注释。
   *   **不得**为了绕过它去放宽 `mountSkillToThread` 的 `SKILL_NOT_ENABLED` 判定。
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
   * ⚠ **为什么它仍然预置，而第 6a / 8a 步的线程是现场建的**：录音的授权矩阵
   *   （`recording_consent_cells`）按 `source_ref_id` 存，而现场新建的线程 id 在种子
   *   跑的时候还不存在，所以授权无从预置 ⇒ 线程与授权只能一起种。
   *   ✅ **「契约里没有任何写授权格子的操作」这句已经失效（#652）**：
   *   `setConsentDecision`（`POST /recording/consent/decisions`）就是补给这张表的
   *   写入口，登记在 `KNOWN_CONTRACT_GAPS.C_REC_6`（`packages/contracts/src/recording.ts`）。
   *   ⇒ 这里预置的理由是**时序**（种子跑在线程创建之前），**不是产品缺口**。
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
