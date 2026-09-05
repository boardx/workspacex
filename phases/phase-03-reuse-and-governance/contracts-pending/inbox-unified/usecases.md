# 契约束 `inbox-unified` — 签核第 ② 件：用例

> 覆盖 feature：**B3.1 … B3.8**，见 `design-signoff.md` frontmatter 的 `covers:`（权威）。
> 规范来源：R4.3 + `uc-17-8-go-live-backlog.md` §B3 + `packages/contracts/src/inbox.ts` 文件头。
> 验收线索编号用 `V`（同本仓其余束），`coverage.md` 以它们为行键。

## UC-B3-1 · 分诊角色打开收件箱（看板 / 列表）

**主角**：本组织的分诊角色成员（`canTriage`）。

1. 进 `/platform-admin/inbox`，默认看板视图，四列 = `InboxStage` 顺序（待处理 → 进行中 →
   已完成 → 不做）。
2. 类型 chip（全部 / 反馈 / 系统异常 / 设计方案）与状态子筛选单选互斥；搜索框匹配
   `title` 与 `code`（「B-12」能搜到）。
3. 列表视图同一份数据、同一套过滤，多「数量/时间」列。
4. 滚到底「加载更多」用服务端 `nextCursor`。

**V1**：非分诊角色 / 非本组织成员 ⇒ `PERMISSION_REVOKED`，屏显示无权限态。
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

**V8**：drawer 时间线读 `listFeedbackStatusEvents`；GitHub 徽标 drawer 展开时现查
`getFeedbackGithubIssue` 升级为 PR（`merged > open > closed`），卡片仍用列表推断值；
「创建 GitHub Issue」复用 `triageFeedback` 的 `issueDraft`，仅 `stage === backlog` 可用。

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
