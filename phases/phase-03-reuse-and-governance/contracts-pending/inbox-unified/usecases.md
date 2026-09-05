# 契约束 `inbox-unified` — 签核第 ② 件：用例

> 覆盖 feature：**B3.1 … B3.8**，见 `design-signoff.md` frontmatter 的 `covers:`（权威）。
> 规范来源：R4.3 + `uc-17-8-go-live-backlog.md` §B3 + `packages/contracts/src/inbox.ts` 文件头。
> 验收线索编号用 `V`（同本仓其余束），`coverage.md` 以它们为行键。

## UC-B3-1 · 组织成员打开收件箱（看板 / 列表）

**主角**：本组织任何成员（D8 ③：读路径对全组织放开；分诊动作仍由 `triageFeedback` 的 `canTriage` 把守）。

1. 进 `/platform-admin/inbox`，默认看板视图，四列 = `InboxStage` 顺序（待处理 → 进行中 →
   已完成 → 不做）。
2. 类型 chip（全部 / 反馈 / 系统异常 / 设计方案）与状态子筛选单选互斥；搜索框匹配
   `title` 与 `code`（「B-12」能搜到）。
3. 列表视图同一份数据、同一套过滤，多「数量/时间」列。
4. 滚到底「加载更多」用服务端 `nextCursor`。

**V1**：非本组织成员 ⇒ `PERMISSION_REVOKED`，屏显示无权限态；本组织非管理员能看标题+票数、看不到别人的正文（D3 逐行判，`body: null`）。
**V2**：排序 `createdAt` 倒序、同刻按 `kind` + `id`；`cursor` 翻页不重复不遗漏。
**V3**：`q` 只搜标题与编号，不搜正文。

## UC-B3-2 · 列头与 chip 徽标读条数

**V4**：`getInboxCounts` 一次给出 `byStage` / `byKind` / `total`，不受过滤影响，`sources` 规则同列表。

## UC-B3-3 · 非超管看不到系统异常那一半

1. 组织管理员（非平台超管）打开收件箱：反馈与设计方案照常，系统异常 chip 禁用并提示
   「仅平台运维可见」。

**V5**：`sources.exception = "withheld"`，结果不含 `exception`，`byKind.exception = 0`，
**不是** 403。

## UC-B3-4 · 看板拖拽 / drawer 按钮改状态

1. 拖卡片到另一列，或在 drawer 里点「开始处理 / 已修复 / 不做 / 重开」。
2. 反馈走 `triageFeedback`，系统异常走 `updateSystemErrorLifecycle`，**不新建接口**。
3. 转「不做」必须填理由（`TRIAGE_REASON_REQUIRED` / `REASON_REQUIRED`），表单不填不让确认。
4. 乐观更新，失败回滚并提示。

**V6**：系统异常不能拖进「已完成」（没有 `done`），按钮不存在。
**V7**：不做无理由被 API 拒，理由随状态一起可见。

## UC-B3-5 · drawer：时间线、GitHub 徽标、建 Issue

**V8**：drawer 时间线读 `listFeedbackStatusEvents`（每步带「已邮件通知提交人」标记）；GitHub 徽标
drawer 展开时现查 `getFeedbackGithubIssue` 升级为 PR（`merged > open > closed`），卡片仍用列表推断值；
建 issue 复用 `triageFeedback` 的 `issueDraft`，仅 `stage === backlog` 可用。

## UC-B3-8 · 转入开发 ⇔ 建 GitHub Issue；徽标可点；评论区；自动挪列（2026-09-05 人类指令）

1. 反馈条目**尚无 issue** 时，任何一条 `backlog → doing` 入口（drawer「转入开发」、卡片/行快捷菜单
   「开始处理」、看板拖进「进行中」）都不直接发请求，落到 drawer 的 **issue 确认表单**；确认后一次
   `triageFeedback(id, "已进入迭代", null, issueDraft)` 同时改状态 + 建 issue。已有 issue 的反馈、
   系统异常仍直接迁移。
2. 表单草稿**整合反馈全部字段**（编号/类型/正文/结构化字段/提交人/时间/票数/附件清单/回链），并
   列出 `InboxItem.attachments`——服务端把**所有**附件（图片内嵌、PDF/文本链接）推到 GitHub；推不上去
   的以 `triageFeedback.out.imageUploadWarnings` 回来，屏上持续警告 `inbox-attachment-upload-warning`。
3. Issue / PR 徽标（卡片、列表、drawer）都是 `<a target="_blank">` 外链；drawer 里 issue 本体与每条
   关联 PR 各一枚。
4. drawer 评论区：`listFeedbackGithubIssueComments` 现查 + `commentOnFeedbackGithubIssue` 提交。
5. 屏每 `INBOX_REFRESH_MS`（2 分钟，同服务端 `FeedbackGithubIssuePollWorker`）静默重拉列表与计数——
   服务端轮询把 issue 已关闭的反馈转「已修复/不做」并发邮件后，条目自动挪到「已完成」，drawer 不闪关。

**V11**：尚无 issue 的反馈转入开发必经确认表单，确认前不发任何请求；`issueDraft.body` 含结构化字段与附件清单。
**V12**：徽标 `href === url`；评论列表/提交调对应接口；2 分钟后卡片跟随服务端状态挪列。

## UC-B3-6 · 从反馈「深化」出设计方案，关联标可点

**V9**：「用 PM 设计工作台深化」调 `deepenFeedback`（`design-workbench.ts`），跳转带真实
`project.id`；推送后反馈条目 `resolvedByDesignId` 非空、设计条目 `linkedFeedbackId` 非空。
**V10**（B3.7）：drawer 内「源自 B-3 / 已生成 D-2」可点击跳转并高亮（路由 `?open=<id>`）。

## 失败模式

| 场景 | 契约错误码 | 屏上表现 |
|---|---|---|
| 无权 | `PERMISSION_REVOKED` | `denied` 态 |
| 下游不可用 | `DEPENDENCY_UNAVAILABLE` | `dep-failed` 态 + 重试 |
| 拖拽迁移失败 | 源操作的错误码 | 回滚 + `inbox-drag-error` |
