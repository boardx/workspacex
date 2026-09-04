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

**待人类逐条 Approve/Reject——同意即可按上表"默认建议"（含本节调整过的 D3）直接排进 Sprint 1。**

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
| B5.3 | 原型画布从占位块升级为可编辑（PDF 明确 out of scope，仅登记） | — | — |

### B6 · 横切（上线门槛）

| ID | 条目 | 估点 | 依赖 |
|---|---|---|---|
| B6.1 | 删除原型 `lib/design-loop-store.tsx` 与 `/preview/feedback-design-loop` 的 localStorage seed（取材页改用 `page.route` 拦截，与 `feedback-loop` 束同范式） | 1 | B1.4, B3.4, B4.5 |
| B6.2 | `lint-nav-reachability` / `ui-material-map.json` 为三个新束补映射；`lint-third-artifact` 的 coverage 表 | 1 | 束切分 |
| B6.3 | 通知：收件箱状态变化沿用现有 `status_event_notification`（邮件）；新增「反馈已生成设计方案」事件类型 | 1 | B4.3 |
| B6.4 | 可观测性：收件箱聚合查询与推送事务的日志/指标（`observability.md`）；`doctor` 对新束的 passing 证据链 | 1 | B3.2 |
| B6.5 | 无障碍与响应式复核：看板拖拽的键盘替代（用操作按钮兜底已在原型）、375/768/1280 三档不横向溢出（U8） | 1 | B3.4 |
| B6.6 | 数据保留：草稿 30 天未动自动清理（与 UC-17.3 数据保留对齐，需人类确认期限） | 1 | B1.2 |

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
