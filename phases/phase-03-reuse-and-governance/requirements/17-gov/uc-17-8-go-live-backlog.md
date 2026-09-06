# UC-17.8 研发闭环 — 上线 Backlog（PR #2660 合入之后）

> 状态：**backlog 输入**（2026-09-04）。PR #2660 交付的是需求录入 + UI 先行原型（真实组件 + mock store）。
> 本文回答「从原型到可上线还差什么」。它是输入，不是权威——按本仓流程，条目要经
> **契约束切分 → 人类签核 `design-signoff.md` → requirement-author 生成 `feature_list.json`**
> 才成为可开工的 feature。Issue 追踪：#2659。

## 0. 前置：人类裁决（不裁决后端无法开工）

| # | 待裁决 | 影响 | 默认建议 |
|---|---|---|---|
| D1 | 结构化字段 vs 2026-09-02「无独立标题字段、标题从正文派生」决策 | 契约 `submitFeedback.in` 形状 | 结构化字段以 **`structured: {field: value}` jsonb 列**入库，标题继续派生；正文保留原文 |
| D2 | 新四态收件箱**替换**还是**并存**旧 `/platform-admin/feedback` 三 tab | 导航、旧屏退役、`feedback-loop` 束是否重签 | 替换：收件箱是同一状态机的新投影，两屏并存 = 同一事实两处声明 |
| D3 | 附件 4 张图片 → 5 个任意文件（PDF §5.1） | 契约 `.max(4)` + MIME 白名单 + 病毒扫描范围 | 数量放宽到 5；MIME 先扩到 image/\*+pdf+txt/md，音视频/zip 留给 B5（见 §0.1） |
| D4 | 弹窗高度 `min(85vh,54rem)`（现）vs `min(680px,88vh)`（PDF） | 纯 UI | 沿用现有 |
| D5 | `DesignLoopProvider` 上提到 AppShell（让「存草稿 / 去工作台」出现在真实入口） | 生产壳层 | 上提，但原型 store 在真栈化时被 API client 取代 |
| D6 | 系统异常是否恢复「仅平台运维可见」（PDF §9） | 权限模型 | 本轮不做，收件箱按组织管理员视角 |
| D7 | AI 对话（草稿细化 / 设计对话）接 deep-agent-service 还是先固定回执上线 | 范围与估点 | 先固定回执上线（B2/B4 里的 AI 项后置成独立束） |
| D8 | **非管理员提交后被导向 `/platform-admin/inbox` 看到「拒绝访问」**——两处独立发现同一根因，见下方说明 | `FeedbackDialog` 直接提交 + 草稿提交（`FeedbackDraftsScreen.onSubmitted`）两处导航；`canTriage` 权限模型 | **已裁决（2026-09-05，方案 ③）**：收件箱读路径对本组织任何成员放开，正文仍按 D3；B3.6 落地 |

**D8 详情（2026-09-04，E2E 落地时发现，两处合并成一条）**：`canTriage`（`apps/api/src/domain/feedback/product-feedback.ts`）
把收件箱访问收紧到 `orgRole === "admin"`；但（a）B3.5 起草时发现 `FeedbackDialog` 若无条件在直接提交后跳
`/platform-admin/inbox` 会让 chat 内非管理员的 agent/skill 反馈入口用户被导到无权页面（已在 `feedback-
dialog.tsx` 上撤回该改动，`inbox-smoke.spec.ts` 用例①标 `test.fixme`）；（b）B1.6 E2E 落地时实测确认
**Sprint 1 已合入 main 的草稿提交导航**（`components/admin/design-loop-screens.tsx`
`FeedbackDraftsScreen.onSubmitted`）同样无条件跳转，同一根因、真实存在于生产。候选方案：①两处都退回「留在
原页面 + toast」不跳转；②仅管理员账号看到跳转，非管理员看到「已提交」提示；③放宽 `canTriage`
使非管理员至少能看到自己提交的那一条（但收件箱是全组织视图，放宽会改变 D2 的可见性口径，牵连更大）。
`feedback-drafts-smoke.spec.ts` 现按方案「如实断言现状」写（非管理员看到拒绝访问，管理员另起一条用例验证
数据确实落库），不预判裁决结果。

**D8 裁决落地（2026-09-05，人类原话「A」= 放宽读路径）**：B3.6 的 e2e「D3 反证：非管理员看得到标题看不到别人的正文」
在 CI 稳定红——旧三 tab 屏下线后，非管理员连收件箱都打不开，等于把已签核的 D3「标题+票数全组织可见」收回去了。
人类在三个方案里选 ③：`listInbox`/`getInboxCounts` 只挡「不是本组织成员」，正文/结构化字段仍逐行走 D3，
系统异常那一半仍只对平台超管，分诊/投票/深化各自的契约操作各自判权限（`canTriage` 本身不动）。单源在契约
`packages/contracts/src/inbox.ts` 头注「谁能打开收件箱」。方案 ①/② 的"导航要不要按角色分流"随之不再需要——
非管理员被导到收件箱现在看到的是自己那条的 drawer；`inbox-smoke.spec.ts` 用例① 的 `fixme` 是另一条冲突
（R4.1 自动跳转 vs 已签核 UC-F1「弹层切到我提过的」），不在本裁决范围。

### 0.1 Agent 推演立场（2026-09-04，人类要求"推演一个合适的答案"）

⚠ 这**不是签核**——`status`/`confirmed_*` 仍归人类，本节只是把"默认建议"从一句话
展开成可以直接同意或反对的论证，减少人类逐条重新推导的成本。

- **D1 采纳**：标题继续派生、结构化字段进 `structured` jsonb。重开"要不要独立标题字段"
  没有必要——PDF 要的是更丰富的**内容**字段（复现步骤/期望结果），不是要回一个标题框；
  jsonb 让字段集合按 `kind` 扩展时不用逐字段迁移。
- **D2 采纳（替换）**：两屏读同一个四态状态机 = 本仓 CLAUDE.md 已警告五次的"同一事实两处声明"。
  并存只有在旧屏覆盖新屏做不到的用例时才成立——它没有，新屏是严格超集（多了系统异常与设计方案）。
  代价是 B3.6 的迁移 PR + `feedback-loop` 束重签，这是正常工作量，不是维持重复状态的理由。
- **D3 部分采纳（更保守）**：数量放宽到 5 张，但 MIME 先只扩到 `image/* + pdf + txt/md`
  （复现日志、截图转 PDF 常见），**暂不放音视频/zip**——那些的病毒扫描路径与存储成本本轮未验证，
  留给 B5（语音附件那时一起做）。不做主张地接受"任意文件"会把安全评审面撑大到功能收益之外。
- **D4 采纳（沿用现有）**：现有高度已被测试锁定、无真实用户投诉支撑；PDF 那个数字更像是
  截图脚本里的实现细节，不是有人提的需求。改了只是重写测试，没有用户收益。
- **D5 采纳，且提前**：成本低、B2.5/B3.7 都依赖它。不做的话"任意界面快速反馈"这个卖点
  在生产里根本不成立——入口只在预览页存在。排进 Sprint 1。
- **D6 采纳（本轮不做）**：同 PDF 建议，推迟。恢复角色隔离是权限模型改动，超出本功能的
  影响半径；本仓不在无关 feature 里顺手做权限工作。作为独立后续条目登记，不并入 B3 范围。
- **D7 采纳（先固定回执）**：接真模型会让 B1+B4 的估点大致翻倍，还给核心链路（反馈进流水线、
  草稿可追踪、设计能推排期）加上不必要的依赖（模型延迟/成本/prompt 质量）。先用已经在
  `feedback-loop` 束验证过的固定回执模式把管线接通，B5 作为独立后续束，等真实使用数据显示
  固定回执确实是摩擦点再决定要不要接真模型。

**✅ 人类裁决（2026-09-04，usamshen 原话：「follow 你的建议，执行吧」）：D1–D7 全部按本节立场采纳（含收窄后的 D3）。**
据此 Sprint 1 = D5 + B2（结构化字段 / 附件放宽 / 语音→字段）+ B1（草稿真栈化）立即开工；
本裁决只覆盖 D1–D7 这七个范围问题，**不替代**各契约束 `design-signoff.md` 的三件签核（ADR-023）。

### 0.2 Sprint 1 落地记录（2026-09-04，PR #2660）
- ✅ D5、B2.1–B2.5（B2.6 截图待重拍）、B1.1–B1.5 已在 PR #2660 真栈化（契约 → api → web），B1.6 E2E 待做。
- ✅ B1.7（草稿附件下载）2026-09-04 补完：`download-feedback-attachment.ts` 三分支
  （feedbackId 走既有 D3 / draftId 走 owner-only 判定 / 两者皆无恒 404），owner 判定借
  `FeedbackDraftRepository.get()` 的既有 owner 谓词——db 层已 owner-scoped，非 owner
  直接落 404 不泄露存在性；`decideFeedbackDraftAttachmentVisibility` 作为 defense-in-depth
  独立可测。7 条单测。
- ✅ B3.1（inbox 契约）2026-09-04 落地：`packages/contracts/src/inbox.ts`，`stageOf()` 是
  `FeedbackStatus`/`SystemErrorStatus` → 四态显示位置的唯一实现；`listInbox`/`getInboxCounts`
  只读投影，状态迁移不新建接口；系统异常对非超管 `sources.exception: "withheld"`（不报错）。
  35 条契约测试。原型 mock 的 `InboxKind`/`InboxItem` 改名 `MockInboxKind`/`MockInboxItem`
  避免与新契约同名撞上 `lint-contract-source`（B3 web 真栈化时会删掉这套 mock，不是本次改名）。
- ✅ B3.2（聚合）+ B3.3（系统异常状态事件）2026-09-04 落地：`application/inbox/` 不跨库
  JOIN（`product_feedback` 走 RLS+`app_rw`，`error_logs` 走 `app_diag_ro`，两套会话模型
  不兼容）——复用既有 `listFeedback`（保留 D3）与 `ErrorLogPort.list`（保留脱敏），应用层
  合并/排序/keyset 分页；`isRequestorPlatformOperator()` 决定 `sources.exception`，非超管
  静默跳过查询而非 403；新增 `system_error_status_events` 表（`updateSystemErrorLifecycle`
  best-effort 追加）。`GET /inbox`、`GET /inbox/counts`。21 条单测。
- ✅ B3.4（web 切真 API）2026-09-04 落地：`inbox-screen.tsx` 从 mock store 切到
  `listInbox`/`getInboxCounts`；看板拖拽走 `triageFeedback`/`updateSystemErrorLifecycle`
  （乐观更新+回滚，不做需理由不做乐观移动，系统异常禁止拖到已完成）；withheld 时
  Chip 禁用+提示。
- ✅ B3.5（GitHub 徽标现查升级 + 建 Issue 编辑器）2026-09-04 落地：drawer 展开时对
  `kind===feedback` 且已关联 github 的条目现查 `getFeedbackGithubIssue`，按
  `merged>open>closed` 升级为 PR 徽标（看板/列表卡片仍用列表推断值，不批量现查）；
  「创建 GitHub Issue」接回真实编辑器（抄 `admin/feedback-screen.tsx` 的
  `defaultIssueDraft`），仅 `stage===backlog` 时可用——`doing→doing` 是幂等 replay
  不会真的建 issue，故未对 `doing` 开放该按钮（避免假成功）。8 条单测。
- ✅ B3.6（旧屏退役）2026-09-04 落地（人类会话原话「同意，B3.6 直接做」授权开工，
  由 agent 代转录）：删除 `components/admin/feedback-screen.tsx` 及其 3 张签核截图
  （`fb-admin-two-columns-{light,dark}.png` / `fb-admin-decline-reason-light.png`）；
  `/platform-admin/feedback`（`app/platform-admin/[module]/page.tsx` 的 `REDIRECTS`）
  与 `/admin/feedback`（`app/admin/[module]/page.tsx`，改直接指向新落点，不经两跳）
  均 301 到 `/platform-admin/inbox`；`AdminModuleKey`/`ADMIN_NAV`/`PLATFORM_ADMIN_ROUTES`
  的 `feedback` 项一并移除（不留一个只会 404 或被重定向吞掉的死键）；删除
  `tests/ui/admin-feedback-live.test.tsx`、`admin-feedback-transitions-match-domain.test.ts`
  （两者只测旧屏，其转移交接/状态迁移的行为已由 `tests/ui/design-loop.test.tsx` 覆盖新屏）；
  `tests/ui/admin-scope-split.test.tsx`/`ops-status-screen.test.tsx` 的 `feedback` 键引用改指
  同组仍存在的 `ops-status`；`e2e/feedback-loop-smoke.spec.ts` 的两条后台处置用例改打
  `/platform-admin/inbox`（`inbox-*` 系列 testid），提交侧 ①②③④四条用例不变；
  `feedback-loop` 束 `ui.md`（引用截图 9→6 张）/`coverage.md`（V7/V10/V11 前端消费点改指
  `inbox-*`，V8/V9 投票入口未随新屏保留，如实降级为 ⚠ 已知限制而非隐藏）已更新；
  `scripts/shot-feedback-loop.mjs` 不再拍「后台两列屏」这三张图；`design-signoff.md`
  新增「B3.6 重开」一节，`status` 字段本身**未改**（ADR-023：agent 不许碰，留给人类
  确认新的 UI 材料后再决定是否需要重签）。
  待做：B3.7（关联标可点击跳转，B4 才有数据）、B3.8（E2E）。

### 0.3 Sprint 3 落地记录

- ✅ B4.1–B4.3（PM 设计工作台真栈化：契约 + `design_projects`/`design_project_chat_messages`
  迁移 + 六条 API）+ B1.6/B3.8 E2E，2026-09-04，PR #2677。
- ✅ B4.4（「用 PM 设计工作台深化」真栈）2026-09-04 落地：契约 `deepenFeedback` 挂在
  `design-workbench.ts`（路由 `POST /feedback/:feedbackId/deepen`——路由命名空间跟着
  backlog 原文，契约文件跟着输出类型 `DesignProject` 的单一事实源，用例文件按"谁是这次
  动作的主语"落在 `application/feedback/deepen-feedback.ts`，三处理由不同、互不矛盾，
  各自的头注写清楚了）。`name`=反馈 `title`、`problem`=反馈 `detail`、`template` 恒
  `wireframe`，服务端读反馈自己填，不接受调用方拼一份可能对不上的值。**幂等键是
  `feedbackId`**：新迁移 `20260904160000_uc178_b44_deepen_feedback_uniq.sql` 给
  `design_projects (org_id, linked_feedback_id)` 加部分唯一索引，仓储用单条
  `INSERT ... ON CONFLICT ... DO NOTHING` 完成"没有就建、有就复用"，不是应用层先查后插
  （那两步之间有窗口）。权限：读正文过 D3（`feedback-detail-decision.ts`），看不到正文
  不能深化（`FEEDBACK_DETAIL_NOT_VISIBLE`）。Web 侧：`inbox-screen.tsx`「用 PM 设计工作台
  深化」按钮从 `design-loop-store.tsx` 的本地 mock 调用改成 `lib/live-feedback.ts` 的真栈
  `deepenFeedback`，跳转带的是服务端返回的真实 `project.id`；`workbench-screen.tsx`/
  `detail-screen.tsx` 仍读那个 mock store（B4.5 才切，不在本次范围）——**已知的、有意的
  过渡态**：跳转 id 是真的，落地页内容暂时还是 mock。PR：`worker/claude-uc17-8-b4-4-deepen-feedback`。
- ✅ B4.5（Web：`workbench-screen`/`detail-screen` 切 API）2026-09-04 落地：新增
  `lib/live-design-workbench.ts`（薄封装 `designWorkbench` 契约六条操作，同
  `live-inbox.ts`/`live-feedback.ts` 成例）；两屏从 `lib/design-loop-store.tsx` 的本地
  mock 切到真实 `listMyProjects`/`createProject`/`updateProject`/`deleteProject`/
  `appendProjectChat`/`pushToInbox`，loading/empty/dep-failed 走 `UiState`。
  「生成中过渡」不再是固定 1.1s 的 `setTimeout`，改成等待 `createProject` 真实返回才
  导航，失败退回弹窗提示。设计详情页没有单条 `getProject` 契约操作（读操作对全组织
  放开，见契约文件头【待确认点 1】），复用 `listMyProjects()` 后按 `id` 客户端查找，
  不为此新开一条路由。对话面板发消息改成真实 `appendProjectChat` 往返，用服务端
  一次返回的 `chat`（用户消息 + 固定回执两条）整体覆盖本地，不本地拼接乐观消息。
  推送成功页两个出口（「查看收件箱」/「继续设计下一个」）读的是 `pushToInbox`
  返回的真实 `inboxCode`，不再是本地 mock 生成的编号。设计详情页脱离 `AppShell`
  独立路由，不再需要挂 `DesignLoopProvider`（`app/platform-admin/design-workbench/
  [projectId]/page.tsx`）。`design-loop-store.tsx` 的 `projects` 相关方法仍保留在文件里
  （没有生产调用方了），删除留给 B6.1。9 条新增/改写单测
  （`tests/ui/design-loop.test.tsx` ⑨⑩）。
- ✅ B4.7（E2E：新建 → 详情 → 推送 → 收件箱出现设计方案 + 原反馈标「已生成」）2026-09-04
  落地：新增 `apps/web/e2e/design-workbench-smoke.spec.ts`，两条串行用例，都用
  `FULLSTACK_E2E.adminEmail`（收件箱/深化按钮要求 `canTriage`，同 `inbox-smoke.spec.ts`
  纪律）。①工作台自己的「新建设计」弹层（backlog 原文点名的主入口）：新建 → 详情页
  （画布/说明两个 tab + 对话面板都渲染）→ 推送 → 确认真实 `POST .../pm-designs/:id/push`
  返回 200/201 且带真实 `D-\d+` 编号 → 收件箱里出现同名 `kind=design` 卡片。②从反馈
  「用 PM 设计工作台深化」（`inbox-screen.tsx`，B4.4/B4.5 真栈）→ 同样的详情/推送/收件箱
  三段 → 额外断言「原反馈标已生成」：原反馈卡片上出现 `link-generated-<code>`「已生成
  方案」标（`CardMeta`，`item.resolvedByDesignId !== null`），drawer 里「查看方案」
  （`inbox-action-open-design`）可见，刷新页面后标记仍在——证明双向关联是服务端
  持久化的，不是本地乐观值。反馈种子直连 API 建（`page.request.post`，同
  `inbox-smoke.spec.ts` 的 `seedFeedback` 头注，不重复驱动已测过的提交弹层 UI）。
  已加入 `playwright.fullstack-smoke.config.ts` 的 `seeded` project `testMatch`。
  PR：`worker/claude-uc17-8-b4-7-workbench-e2e`。后续修了两处：后端读侧把 `resolvedByDesignId` 真正从
  `product_feedback.resolved_by_design_id` 投影出来（契约 `FeedbackItem` 此前根本没有这个字段）；
  用例②改按详情页 URL 里的项目 id 找卡片（`listMyProjects` 是 `created_at ASC`，`.first()`
  拿到的是最老的项目，推错了项目）。
- ✅ B4.6（设计详情取材页与截图更新 + 该束 `ui.md`）2026-09-04 落地：`design-workbench`
  此前**没有** `contracts/design-workbench/` 目录（B4.1–B4.5 全部实现落地，但契约束的
  `design-signoff.md`/`ui.md` 从没建过）——本条一并把两个文件建出来（`design-signoff.md`
  `status: pending`，等待人类签核，ADR-023 下 agent 不改这个字段）。截图脚本
  `apps/web/scripts/shot-feedback-design-loop.mjs` 新增 `routeDesignWorkbench()`：B4.5 把
  `workbench-screen.tsx`/`detail-screen.tsx` 切到真实 `/pm-designs*` 之后，取材页原来的
  8 张 `workbench-*`/`detail-*` 截图在没有真实后端时已经拍不出来（真实请求会挂起/失败）
  ——这条 `page.route()` 拦截同 `feedback-loop`/`inbox-unified` 两束各自真栈化时补过的
  同一件事。全部 16 张重拍（8 张既有 + 8 张新态）：工作台首页新增
  `loading`/`denied`/`dep-failed` 三态（`?state=` 直接驱动展示分支，不发真实请求）+
  `generating` 一态（截图脚本让 `createProject` 故意晚 2s 才 `fulfill`，在真实等待期间
  截下这一帧，不是摆拍）；详情页新增 `loading`（`/pm-designs` 挂起不 `fulfill`）/
  `dep-failed`（回 503）/`missing`（id 查不到，走 `scene=detail-missing` 而非 `?state=`——
  `resolvePreviewState` 只认七态白名单，非法值会静默落回 `default`）三态，均为真实请求
  结果分支，不是 UI 层摆出来的。16 张截图落进新目录 `ui-preview/design-workbench/`（脚本
  按文件名前缀 `workbench-`/`detail-` 自动分流，不与同一份脚本产出的 `dialog-*`/
  `drafts-*`/`inbox-*` 混目录——那些属于另外的契约束）；`ui-material-map.json` 补
  `design-workbench` 一行；`lint-ui-material` 全仓 41 束双向对账绿（857 张）。
  PR：`worker/claude-uc17-8-b4-6-workbench-screenshots`。
- ✅ B4.7（E2E：新建 → 详情 → 推送 → 收件箱出现设计方案 + 原反馈标「已生成」）2026-09-04
  落地：新增 `apps/web/e2e/design-workbench-smoke.spec.ts`，两条串行用例，都用
  `FULLSTACK_E2E.adminEmail`（收件箱/深化按钮要求 `canTriage`，同 `inbox-smoke.spec.ts`
  纪律）。①工作台自己的「新建设计」弹层（backlog 原文点名的主入口）：新建 → 详情页
  （画布/说明两个 tab + 对话面板都渲染）→ 推送 → 确认真实 `POST .../pm-designs/:id/push`
  返回 200/201 且带真实 `D-\d+` 编号 → 收件箱里出现同名 `kind=design` 卡片。②从反馈
  「用 PM 设计工作台深化」（`inbox-screen.tsx`，B4.4/B4.5 真栈）→ 同样的详情/推送/收件箱
  三段 → 额外断言「原反馈标已生成」：原反馈卡片上出现 `link-generated-<code>`「已生成
  方案」标（`CardMeta`，`item.resolvedByDesignId !== null`），drawer 里「查看方案」
  （`inbox-action-open-design`）可见，刷新页面后标记仍在——证明双向关联是服务端
  持久化的，不是本地乐观值。反馈种子直连 API 建（`page.request.post`，同
  `inbox-smoke.spec.ts` 的 `seedFeedback` 头注，不重复驱动已测过的提交弹层 UI）。
  已加入 `playwright.fullstack-smoke.config.ts` 的 `seeded` project `testMatch`。
  PR：`worker/claude-uc17-8-b4-7-workbench-e2e`。B4.6（取材页/截图）另行并行推进，不在
  本条范围。

### 0.4 Sprint 4 落地记录

- ✅ B5.1（草稿「继续完善」对话接模型 + 提交时对话摘要成结构化字段）2026-09-05 落地：
  新建契约束 **`design-ai-collab`**（`contracts/design-ai-collab/` 五件材料齐，
  `design-signoff.md` `status: pending`、`covers: [B5.1, B5.2]`，等人类签核；
  `design-coherence.md` §2.6 交叉约束草稿，frontmatter 未动——ADR-023 归人类）。
  契约：新文件 `packages/contracts/src/design-ai-collab.ts` 只声明两束共用的
  `AiReplySource`（`model`/`fallback`）；`feedback-loop.ts` 的 `FeedbackDraftChatTurn` 加
  `source?`（AI 记录）、`appendChat` 输入不接受它、`submitFeedbackDraft.out` 加 `chatSummary`。
  实现走 `structureFeedbackDraft` 那条链（同一个 `ModelCallPort` + 同一份
  `FEEDBACK_STRUCTURE_MODEL_CONFIG` + `parseStructuredForKind` 同一套解析），**不走**
  agent-run（理由见该束 `domain.md` §3：对话历史单一事实源在 `drafts.chat[]`，远端 thread
  是第二份副本）：`application/feedback/drafts/draft-refine-model.ts`（端口 `DraftRefineModel`
  + 唯一实现 `ModelDraftRefiner`：首次澄清问题 / 每轮回复 / 提交时摘要，30s/30s/60s 超时，
  失败**不抛**、退回 D7 固定文案并标 `source: "fallback"`；固定文案的单一事实源搬到这里，
  `update-feedback-draft.ts` 转发导出）。Web：`drafts-screen.tsx` 浮层 AI 气泡按
  `source === "fallback"` 挂「固定回执」标识（`draft-refine-turn-fallback`），布局不变。
  单测：`tests/feedback/draft-refine-model.test.ts`（fake port：prompt 含 kind/字段/正文/
  按序历史、不传 threadId；失败/空输出退路；摘要按 kind 严格解析、覆盖同名保留其余、
  别 kind 键丢弃）+ `draft-lifecycle.test.ts` 三条新/改（`FakeDraftRefiner`）+
  `tests/ui/feedback-drafts-live.test.tsx` 一条。截图：本束不新增屏，`ui-preview/
  design-ai-collab/` 按 phase-10 先例复制两张既有图（`drafts-refine-light` /
  `detail-canvas-dark`），`ui-material-map.json` 补一行。
  PR：`worker/claude-uc17-8-b5-1-draft-refine-ai`。
- ✅ B5.2（设计详情左侧对话接模型 + 回复写回 `problem/criteria/frames`）2026-09-05 落地
  （分支从 B5.1 切出，PR 依赖 B5.1 的 PR）：契约 `design-ai-collab.ts` 增 `DesignWritebackField`
  / `DesignChatWriteback` / `DesignChatReply`；`design-workbench.ts` 的 `DesignProjectChatTurn`
  加 `source?`，`appendProjectChat.out` 加 `reply: { source, applied }`，头注改口（固定回执
  降为退路；`criteria`/`frames`「用户不能直接编辑，可经对话由模型写回」；写回选**直接写回 +
  返回 `applied`**而非返回建议等确认，理由写在该操作头注）。迁移
  `20260905130000_uc178_b52_design_chat_source.sql`（`design_project_chat_messages.source`
  可空 CHECK 闭集，不回填旧记录）。`application/design-workbench/design-chat-model.ts`
  （端口 `DesignChatModel` + `ModelDesignChatReplier`：同 B5.1 那条 `ModelCallPort` 链，
  不传 `threadId`；输出 JSON `{reply, writeback}`，`writeback` 逐字段过契约、非法字段只丢
  该字段；失败退回 `DESIGN_WORKBENCH_CHAT_REPLY` 标 fallback）；`append-project-chat.ts`
  先写回（`projects.update` 同 owner 谓词，`DesignProjectPatch` 加 `criteria`/`frames`）再
  原子追加两条，返回写回后的 `project` + `reply`。「每项目独立 thread」= 只喂本项目
  `chat[]`，thread 身份即 project id。Web：`detail-screen.tsx` 消费 `reply.applied`（最后一条
  AI 气泡下「已更新：…」，`design-detail-chat-applied`）+ 「固定回执」标识
  （`design-detail-turn-fallback`）；右侧说明页/画布标签随返回的 `project` 一起变。单测：
  `tests/design-workbench/design-chat-model.test.ts`（新，4 条）、`project-lifecycle.test.ts`
  （4 条新/改，含「只看到本项目历史」「非 owner 不调模型」）、
  `tests/ui/design-loop.test.tsx` 1 新 1 改；`permission-propagation-six-paths.test.ts`
  （真 PG）过迁移。PR：`worker/claude-uc17-8-b5-2-design-chat-ai`。
- ~~B5.3 不做（PDF 明确 out of scope，仅登记）。~~ **2026-09-06 人类推翻**：原型画布做成模型
  生成的**结构化 JSON 组件树**（不是 HTML），本轮只做「整页重生成」，增量修改下一轮；
  顶栏可「导出设计文档」（Markdown）。新契约束 `contracts/design-prototype/`（五件材料齐，
  `status: pending` 待签核）。契约：`design-prototype.ts`（13 种原语闭集、`PrototypeScreen` 上限）
  + `DesignProject.prototype`（按位置对应 `frames[i]`，`superRefine` 门控）+ `DesignChatWriteback.prototype`；
  API：`append-project-chat.ts` 把 `{frame,root}[]` 拆成 `frames`+`prototype` 一次写入，只改 `frames` 清空树
  （迁移 `20260906160000_uc178_b53_design_prototype.sql`），超时 30s→90s；Web：`prototype-canvas.tsx`
  渲染表按类型穷举、`lib/design-doc-markdown.ts` 导出。截图 `ui-preview/design-prototype/` 三张。
- ✅ B6.5（无障碍与响应式复核）2026-09-05 落地：
  **键盘替代**——看板拖拽的每一条合法迁移都有 drawer 操作按钮做同一件事：按 `stage × kind`
  逐格核对两个源状态机（`product-feedback.ts` `ALLOWED_TRANSITIONS`、`system-error-logs.ts`
  头注），按钮集 = 合法边全集（backlog→doing/archived；doing→done[仅反馈]/backlog/archived；
  done|archived→backlog），拖拽能试而按钮没有的边（如 done→doing）服务端本就 `ILLEGAL_TRANSITION`。
  卡片补 `aria-label`（编号+标题）、`aria-describedby` 指向 sr-only 的键盘替代说明、拖起时
  `aria-grabbed`；列容器 `role="group"` 带列名与数量。**焦点管理**新增
  `components/design-loop/use-dialog-focus.ts`（打开焦点进面板 / Esc 关闭 / 关闭后焦点回到触发
  元素，不做 Tab 陷阱——理由见文件头），挂在收件箱 drawer、草稿编辑 drawer、「继续完善」浮层、
  工作台新建/编辑弹窗。**响应式（U8）**：看板 md 以下四列横向可滚（列容器 `overflow-x-auto` +
  `data-allow-x-scroll` 显式声明，页面不横向溢出）、列表视图宽表格同法；工作台三张模板与项目
  网格 `1/sm:2/lg:3` 列；草稿「继续完善」浮层与设计详情页 md 以下由左右两栏改为上下堆叠
  （详情页对话面板限高 40dvh 自身滚动、画布占余下——不折叠成抽屉，对话是这屏唯一修改入口；
  不并排缩窄，360+260px 在 375 下装不下，实测溢出 90px）；drawer 靠 `max-w-full` 在 375
  自然全宽。md 及以上布局不变，1360 截图像素未动（未重拍）。**验证**：
  `tests/ui/design-loop.test.tsx` ⑪ 10 条（aria 属性、7 格迁移按钮表恰好相等、Enter 开/Esc 关/
  焦点归位）；新 `e2e/design-loop-responsive.spec.ts`（四屏 + drawer/浮层共 10 景 × 三档 = 30
  条 `scrollWidth` 断言，取材页 + `page.route` 夹具、不需要后端），夹具抽成
  `scripts/lib/design-loop-fixtures.mjs` 与截图脚本共用（单一事实源），spec 挂进
  `playwright.fullstack-smoke.config.ts` 无依赖 project `design-loop-responsive`（同
  `axe-keyboard-focus`）。修前 375 下「继续完善」浮层与详情页两处红，修后 30/30 绿。
- ✅ B3.7（关联标可点击跳转并高亮）2026-09-05 落地：`badges.tsx` 的 `LinkBadge` 给了
  `onClick` 就渲染成真按钮（焦点环、`stopPropagation` 不冒泡成「打开本卡片」），没给仍是
  只读标（取材页）。`inbox-screen.tsx` 新增 `navigateToLinked`：「已生成方案」目标 =
  `resolvedByDesignId`（= 设计条目 `id`），「源自反馈」目标 = `linkedFeedbackId`（= 反馈条目
  `id`），两端都在同一屏，所以是**屏内换 drawer**（`setOpenId` + drawer 按 `key={id}` 重挂）
  + 目标卡片/行短暂 `data-highlighted="true"`（`ring-primary` token，1.8s 自清，看板/列表
  两种视图都认），不换路由、不新增契约操作。目标被客户端 `stage` 子筛选挡住时放宽到
  「全部」（纯本地过滤）；目标不在已加载 `items` 里（服务端 `kind`/`q` 筛掉或还在下一页）
  时**老实提示** `inbox-link-target-missing`，不静默、不偷偷改服务端筛选。URL：屏本身不碰
  路由，新增 `onOpenLinked` 回调，生产落点 `design-loop-screens.tsx` 用
  `history.replaceState` 写 `?open=<id>`（Next 14.1+ 与 `useSearchParams` 同步，不走
  `router.replace` 的 RSC 往返、不重置滚动）。4 条新增单测（`design-loop.test.tsx` ⑪：
  看板往返跳转 + 高亮 + 回调、列表行不冒泡、目标缺失提示、生产落点 URL），
  反证：去掉 `stopPropagation` 后 3 条转红。E2E：#2726 合入后在
  `design-workbench-smoke.spec.ts` ② 末尾补了「反馈 drawer 里点『已生成方案』→ drawer
  换成设计条目（按 `inbox-card-<D-code>` 找）+ 目标卡片 `data-highlighted` + URL `?open=<projectId>`」，
  在 CI `fullstack-smoke` 跑真栈。PR：`worker/claude-uc17-8-b3-7-clickable-relation-badges`。

- ✅ B6.4（可观测性）2026-09-05 落地：`application/inbox/aggregate-inbox-sources.ts` 把
  `listInbox`/`getInboxCounts` 各自复制的"拉反馈 → 拉系统异常（受 cap）→ 拉设计项目"抽成
  一处，每次聚合记一条结构化 `info`（`traceId` 透传自 `traceIdOf(req)`；三源行数、各源耗时、
  `exceptionCapHit`、`exceptionSource` withheld/included、返回条数、是否有下一页、`qPresent`
  布尔——**不记**正文/标题/提交人/搜索词原文，D3 门控不能被日志旁路）。`fetchAllExceptions`
  改返回 `{ items, capHit }`：`list-inbox.ts` 文件头那条"每次请求重新拉两源"的已知取舍，
  从此在撞 `INBOX_EXCEPTION_FETCH_CAP` 的那一刻值班可见（此前超出上限的异常静默不在收件箱）。
  `pushToInbox` 事务成功后记一条 `info`（`projectId`/`ownerId`/`resolvedFeedback`/
  `repeatPush`（upsert 命中）/`linkedFeedback`/`notePresent`/`inboxCode`/事务耗时；不记
  `note` 正文与项目名；失败路径不在这里记——异常一路抛到 `AllExceptionsFilter` 按同一
  `traceId` 落 `error_logs`）。`logger`/`traceId` 在 `ListInboxDeps`/`GetInboxCountsDeps`/
  `DesignProjectDeps` 上**都是可选**，单测 fake 端口不需要；两个 controller 注入 `LOGGER_PORT`。
  本仓没有独立 metrics 端口（`ports/` 只有 `LoggerPort`），"指标"按 `observability.md`
  落成结构化日志字段，不引新依赖。10 条新增单测（fake logger 断言字段存在 + 断言敏感内容
  不在日志里）。`doctor --phase 03 --strict` 在 main 上 0 FAIL——三束相关的签核链 / evidence /
  派生视图没有可机械修的红；`design-workbench` 束 `status: pending` 等人类签核（不改）。
- ✅ B6.2（映射）2026-09-05 落地：`ui-material-map.json` phase-03 加 `inbox-unified` /
  `feedback-drafts` 两行（`shared_dir: ui-preview/feedback-design-loop`——同一份
  `shot-feedback-design-loop.mjs` 产出 `inbox-*`/`drafts-*`/`dialog-*`，同 phase-10 的共用目录
  先例），删掉此前 #2556 随手带入的幽灵行 `user-research-studio`（束目录与截图目录都不存在）；
  `third-artifact-map.json` 加 `inbox-unified → inbox`、`feedback-drafts → feedback-loop`
  （六条 `*FeedbackDraft*` 操作按 B1.1 原文挂在 `feedback-loop.ts`）；
  `nav-reachability.config.json` 新增 phase-03 段（四束：`design-workbench` 一级直达；
  `feedback-loop`/`inbox-unified`/`feedback-drafts` 三束现行屏挂平台后台二级，入口
  `/platform-admin`，同配置 `//3`「断言束的入口在导航里即可」先例；要不要给收件箱/草稿加
  一级导航是 IA 裁决，不在门控里替人类定）。三道 lint 全绿。
  **两束的五件材料已写好但没搬进 `contracts/`**：`contracts/` 下每多一个束目录，
  `auditSignoff` 就要求 `design-coherence.md` 的 `covers_bundles` 覆盖它，否则
  `doctor --strict` FAIL（CI 红）——而 `covers_bundles` 归人类所有，agent 不得改
  （ADR-023「不要只改 covers_bundles」）。材料放在 `contracts-pending/{inbox-unified,feedback-drafts}/`
  （该目录不被任何门控读取，见其 README），本地临时放进 `contracts/` 验证过：三道 lint 绿、
  `doctor --strict` 只剩「一致性复核没覆盖这两束」一条红。**待人类**：读两束 `design-signoff.md`
  → 重做阶段一致性复核并补 `covers_bundles` → `git mv` 进 `contracts/`（一次动作，README 写了步骤）。
  两束 `design-signoff.md` 如实写"补签"（同 `design-workbench` 束），`covers` 用 B1.x / B3.x
  backlog 编号（同 B4.x 先例），与既有两束无重叠（doctor 的 covers 重叠检查已验证）。
- ✅ B6.3（通知：收件箱状态变化沿用 `status_event_notification`；新增「反馈已生成设计方案」
  事件类型）2026-09-05 落地。**核实结果**：收件箱看板拖拽走的 `PUT /feedback/:id/status`
  （`triageFeedback`）**已经**在每次真实状态迁移后 best-effort 给提交人发「状态已更新」邮件并
  回填事件行 `notified`/`email_subject`/`email_text`，"沿用"这半句不需要新代码；系统异常
  那一半（`updateSystemErrorLifecycle`）只写 `system_error_status_events` 流水、**没有**任何
  邮件通知——系统异常没有"提交人"这个角色，记为已知缺口、不在本条扩范围。**新事件**：
  `product_feedback_status_events` 装不下"已生成 D-X"（列 CHECK 四态、契约 `FeedbackStatus`
  闭集，B4.3 头注已解释），所以"事件类型"落在**通知层**：新文件
  `application/feedback/feedback-notification-templates.ts` 单源声明
  `FEEDBACK_NOTIFICATION_KINDS = ["status_changed", "design_generated"]` 与两个模板，
  `triage-feedback.ts` 的私有 `statusChangeEmail` 搬进去（subject/text 逐字不变），
  `push-to-inbox.ts` 在仓储回报 `resolvedFeedback !== null` 时给来源反馈提交人发
  「你的反馈《…》已生成设计方案 D-n」。**去重口径**：仓储 `UPDATE product_feedback` 谓词加
  `resolved_by_design_id IS DISTINCT FROM $3`、RETURNING `submitted_by`/`title`——外键首次指向本
  项目才非空，重复推送（upsert 刷新 `pushed_at`/`push_note`）回 `null` ⇒ 不发第二封；不另建
  "已通知"表（同一事实不声明两处）。邮件失败/提交人无邮箱 = best-effort，只记日志
  （`traceId: design-push-notify`），推送事务已提交、不受影响，同 `notifySubmitter` 纪律。
  `DesignProjectDeps` 新增可选 `mail`/`logger`（controller 注入，缺任一即不发）；契约
  `pushToInbox.out` 与 `feedback-loop.ts` 状态枚举均未动，不改 web。单测：
  `tests/design-workbench/project-lifecycle.test.ts` 新增 6 例（首次推送通知一次且收件人/编号
  正确、无 linked 不发、重复推送不重复发、无邮箱记 info、发送失败记 error 不抛、未注入不发）。
- ✅ B6.1（删除原型 `lib/design-loop-store.tsx` 与取材页 localStorage seed）2026-09-05 落地：
  B1.4/B3.4/B4.5 之后三屏全部真栈，store 里剩下的 `projects`/`pushProject`/`deepenFeedback`
  等方法已无生产调用方——整个文件删除（`grep -rn design-loop-store apps/web` 归零，仅剩
  历史注释里"已删除"的说明）。`AppShell` 不再挂 `DesignLoopProvider`（D5 上提的那一层随之
  拆掉）；反馈弹层「去 PM 设计工作台」入口原本靠 Provider 在场判可见，改成**恒可见的纯路由
  跳转** `/platform-admin/design-workbench`。取材页 `/preview/feedback-design-loop` 删掉
  `seed`/Provider，`workbench-empty` 空态与其它四屏一样由 `shot-feedback-design-loop.mjs`
  的 `page.route` 拦截回空 `items` 得到（`routeDesignWorkbench({ empty })` B4.6 已就位）
  ——与 `feedback-loop` 束同范式。单测 `design-loop.test.tsx` 删去测 mock store 的
  「⑧ pushProject 标记已推送并生成 D- 编号」整块（`renderHook(useDesignLoop)`），其余用例
  去掉 `DesignLoopProvider` 包裹。UI 像素未变，**截图不重拍**（`lint-ui-material` 双向对账
  仍绿）。README 第 9 条 / `design-workbench/ui.md` 相应改写。
  PR：`worker/claude-uc17-8-b6-1-delete-prototype-store`（Refs #2659，承接 #2727）。

## 1. 契约束切分建议（ADR-023：每束一份 design-signoff，三件一起签）

```
feedback-drafts        草稿：Draft 实体 + 5 个 API + 草稿列表/编辑/继续完善
inbox-unified          统一收件箱：三类来源投影 + 四态状态机对齐 + 看板/列表 + drawer
design-workbench       PM 设计工作台：Project 实体 + 推送 → 收件箱 + 双向关联
(后置) design-ai-collab 草稿细化与设计对话接真 AI
```

## 2. Backlog 条目

估点为相对点（本仓 F48=5、F49=3 作参照）。「验证」写的是将来 `feature_list.json` 的 verification 锚点方向。

### B1 · 反馈草稿真栈化（束 `feedback-drafts`）

| ID | 条目 | 估点 | 依赖 |
|---|---|---|---|
| B1.1 | 契约：`packages/contracts/src/feedback-loop.ts` 新增 `FeedbackDraft` 实体（`id, kind, structured, body, chat[], attachmentIds[], createdAt, updatedAt, refineSeeded`）与 5 个操作：`createDraft POST /feedback/drafts`、`listMyDrafts GET`、`updateDraft PATCH /:id`、`deleteDraft DELETE /:id`、`submitDraft POST /:id/submit`（→ 走现有 `submitFeedback` 落库，返回 feedback id） | 3 | D1, D3 |
| B1.2 | 迁移：`product_feedback_drafts` 表（per-user，RLS：只有 owner 可读写）；附件 claim 窗口复用 `feedback_attachments`（`feedback_id NULL` 时允许挂到 draft） | 2 | B1.1 |
| B1.3 | API：5 个 use case + controller + 单测（`apps/api/tests/feedback/drafts-*.test.ts`）；`submitDraft` 事务内删草稿 + 建反馈 + 迁附件归属 | 3 | B1.2 |
| B1.4 | Web：`lib/live-feedback.ts` 加 5 个 client 函数；`feedback-dialog` 的「存为草稿」改调 API；`drafts-screen` 从 `design-loop-store` 切到 API（loading/empty/error 三态用 `UiState`）；导航徽标改读 `GET /feedback/drafts/count` | 3 | B1.3, D5 |
| B1.5 | 草稿编辑不覆盖对话轨迹（PDF §7）：编辑追加一条 `{role:"user", edited:true}` 而非折叠 | 1 | B1.4 |
| B1.6 | E2E：存草稿 → 草稿列表 → 继续完善 → 提交 → 收件箱可见（`feedback-drafts-smoke.spec.ts`，加入 `playwright.fullstack-smoke.config.ts` seeded project） | 2 | B1.4 |

### B2 · 快速反馈弹窗真栈化

| ID | 条目 | 估点 | 依赖 |
|---|---|---|---|
| B2.1 | 契约：`submitFeedback.in` 加 `structured` jsonb（缺陷 5 字段 / 需求 4 字段，按 `kind` 用 discriminated union 校验）；`FeedbackItem` 输出同样带 `structured` | 2 | D1 |
| B2.2 | 迁移 + API：`product_feedback.structured jsonb`（不可变列触发器要加入白名单）；`submit-feedback.ts` 落列；`list-feedback` 投影 | 2 | B2.1 |
| B2.3 | 附件放宽：契约 `.max(5)`、MIME 扩到 `image/*+pdf+txt/md`（音视频/zip 留 B5）、`upload-feedback-attachment.ts` 大小/类型/扫描规则同步；web 端 accept 与拒绝提示同步 | 2 | D3 |
| B2.4 | 语音 → 结构化字段：`structureFeedbackDraft` 输出从 `{title, detail}` 扩成按 `kind` 的结构化字段（`feedback-structure-model-config.ts` prompt 改）；复现步骤输出编号步骤 | 2 | B2.1 |
| B2.5 | 「更复杂？去 PM 设计工作台」链接在真实壳层可见（D5）；从弹窗跳转时携带 `kind` + 已填字段作为 `problem` 预填 | 1 | D5, B4.4 |
| B2.6 | 更新 `feedback-loop` 束 `ui.md` 截图（弹窗变了，签核材料要跟上；`lint-ui-material` 双向对账） | 1 | B2.4 |

### B3 · 统一收件箱真栈化（束 `inbox-unified`）

| ID | 条目 | 估点 | 依赖 |
|---|---|---|---|
| B3.1 | 契约：`InboxItem` 投影（`kind: feedback\|design\|exception`，四态 `backlog\|doing\|done\|archived` ↔ 现有 `待处理\|已进入迭代\|已修复\|不做` **只做显示名映射，不建第二套枚举**）；`listInbox GET /inbox?kind&status&q`、`getInboxCounts GET /inbox/counts`；状态迁移继续走 `PUT /feedback/:id/status`，设计方案与系统异常各自有 `PUT /design-projects/:id/status`、`PUT /system-errors/:id/status` | 3 | D2 |
| B3.2 | API：`list-inbox.ts` 聚合三源（feedback / design_projects / system_errors）分页 + 搜索；`severe` 由系统异常次数阈值或反馈标签派生（口径写进 `domain.md`） | 3 | B3.1 |
| B3.3 | 系统异常四态：现有 `live-system-errors` 只有列表，需要状态列 + 迁移 + 事件表（同 `product_feedback_status_events` 形状） | 2 | B3.1 |
| B3.4 | Web：`inbox-screen` 从 store 切到 API；看板 drop 调真迁移（乐观更新 + 失败回滚 + `TRIAGE_REASON_REQUIRED` 处理）；drawer 时间线读 `listFeedbackStatusEvents` | 3 | B3.2 |
| B3.5 | GitHub 徽标：drawer 与卡片读现有 `getFeedbackGithubIssue`（Issue 状态 + linked PR `open/draft/merged/closed`）；「创建 GitHub Issue」复用 `triageFeedback` 的 `issueDraft` 编辑器（不再是随机编号） | 2 | B3.4 |
| B3.6 | 旧屏退役（若 D2 = 替换）：删除 `feedback-screen.tsx`、`/platform-admin/feedback` 301 到 `/platform-admin/inbox`、更新 `admin-feedback-*` 测试与 `feedback-loop` 束 `ui.md`/`coverage.md`，并请人类**重签**该束（ADR-023：签核材料变了） | 3 | B3.4 |
| B3.7 | 关联标可点击跳转并高亮（PDF §9）：drawer 内「源自 B-3 / 已生成 D-2」→ 路由带 `?open=<id>` | 1 | B3.4, B4.5 |
| B3.8 | E2E：直接提交 → 收件箱自动开 drawer；看板拖拽 → 状态事件落库；不做无理由被 API 拒 | 2 | B3.4 |

### B4 · PM 设计工作台真栈化（束 `design-workbench`）

| ID | 条目 | 估点 | 依赖 |
|---|---|---|---|
| B4.1 | 契约：`DesignProject` 实体（`id, name, template, problem, criteria[], frames[], pushed, pushedAt, linkedFeedbackId, ownerId, updatedAt`）+ 操作：`createProject / listProjects / updateProject / deleteProject / pushToInbox POST /:id/push`（幂等，重复推送更新同一条收件箱条目） | 3 | — |
| B4.2 | 迁移：`design_projects`、`design_project_chat_messages`（每项目独立历史）；RLS per org；`product_feedback.resolved_by_design_id` 外键（反馈 → 方案）；`design_projects.linked_feedback_id`（方案 → 反馈）——**双向关联在 DB 用一对外键 + 唯一约束，不存两份** | 2 | B4.1 |
| B4.3 | API：use cases + controller；`pushToInbox` 事务内：标记 pushed、生成收件箱条目（`kind=design`, `status=backlog`）、回写来源反馈的 `resolved_by_design_id` 与一条状态事件「已生成 D-X」 | 3 | B4.2 |
| B4.4 | 「用 PM 设计工作台深化」真栈：`POST /feedback/:id/deepen` → 建项目（名称=标题，problem=正文，template=wireframe）并**直接跳到项目详情页**（PDF §9 建议，原型跳首页） | 2 | B4.3 |
| B4.5 | Web：`workbench-screen` / `detail-screen` 切 API；生成中过渡改为等待 `createProject` 返回；推送成功页两个出口读真 id | 3 | B4.3 |
| B4.6 | 设计详情**取材页与截图**更新 + 该束 `ui.md`（深色 IDE 页是新屏，签核第 ① 件） | 1 | B4.5 |
| B4.7 | E2E：新建 → 详情 → 推送 → 收件箱出现设计方案 + 原反馈标「已生成」 | 2 | B4.5 |

### B5 · AI 协作（后置束 `design-ai-collab`，D7 裁决后）

| ID | 条目 | 估点 | 依赖 |
|---|---|---|---|
| B5.1 | 草稿「继续完善」对话接 deep-agent-service：澄清问题由模型按 `kind` + 结构化字段生成；对话历史落 `drafts.chat[]`；提交时模型把对话摘要成结构化字段 | 5 | B1.4 |
| B5.2 | 设计详情左侧对话接 deep-agent-service：每项目独立 thread；回复可写回 `problem/criteria/frames`（画布仍是占位块） | 5 | B4.5 |
| B5.3 | 原型画布：对话驱动、模型整页生成结构化组件树；导出设计文档（2026-09-06 人类推翻「仅登记」；增量修改为后续条目） | 8 | B5.2 |

### B6 · 横切（上线门槛）

| ID | 条目 | 估点 | 依赖 |
|---|---|---|---|
| B6.1 | 删除原型 `lib/design-loop-store.tsx` 与 `/preview/feedback-design-loop` 的 localStorage seed（取材页改用 `page.route` 拦截，与 `feedback-loop` 束同范式） | 1 | B1.4, B3.4, B4.5 |
| B6.2 | `lint-nav-reachability` / `ui-material-map.json` 为三个新束补映射；`lint-third-artifact` 的 coverage 表 | 1 | 束切分 |
| B6.3 | 通知：收件箱状态变化沿用现有 `status_event_notification`（邮件）；新增「反馈已生成设计方案」事件类型 | 1 | B4.3 |
| B6.4 | 可观测性：收件箱聚合查询与推送事务的日志/指标（`observability.md`）；`doctor` 对新束的 passing 证据链 | 1 | B3.2 |
| B6.5 | 无障碍与响应式复核：看板拖拽的键盘替代（用操作按钮兜底已在原型）、375/768/1280 三档不横向溢出（U8） | 1 | B3.4 |
| B6.6 | ~~数据保留：草稿 30 天未动自动清理~~ **不做（2026-09-05 人类裁决：「b6.6 不需要自动清理」）**——草稿是提交人私有资源，保留到本人删除或提交为止；若将来 UC-17.3 数据保留策略要求统一期限，再作为新条目重开 | — | — |

## 3. 估点汇总与建议顺序

| 束 | 估点 | 建议 sprint |
|---|---|---|
| 前置裁决 D1–D7 | 人类动作 | 立即 |
| B2 快速反馈弹窗 + B1 草稿 | 10 + 14 = 24 | Sprint 1（用户侧先通） |
| B3 统一收件箱 | 19 | Sprint 2（后台切换，含旧屏退役与重签） |
| B4 设计工作台 | 16 | Sprint 3 |
| B6 横切 | 6 | 随各 sprint 收尾 |
| B5 AI 协作 | 10+ | 独立后置 |

合计约 **75 点**（不含 B5）。每束按本仓流程：签核 → `harness sync --apply` 建 issue → 一 feature 一 PR → `harness verify` → 合入 main 全绿。
