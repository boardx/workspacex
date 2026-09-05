# 契约束 `inbox-unified` — 支撑材料②：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
>
> 覆盖 feature：**B3.1 … B3.8**
> ⚠ **这一行是派生视图，不是权威。** 束↔feature 映射的权威是 `design-signoff.md`
> frontmatter 的 `covers:`（ADR-023 决策三）。
>
> 验收线索来源：`usecases.md` 的 **V1–V10**。

「前端消费点」列填**已建成界面**里的真实 `data-testid`
（`components/design-loop/inbox-screen.tsx`，已在仓库中核实）。

---

## 一、UC → API（R12 验收线索 V1–V10）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 非本组织成员 ⇒ `PERMISSION_REVOKED`；成员可读、正文按 D3 | `listInbox` / `getInboxCounts` `err`；`InboxItem.body` nullable | `denied` / `inbox-drawer-body-withheld` | ✅ `list-inbox.test.ts` 权限 + B3.6 e2e「D3 反证」 |
| V2 | 倒序归并 + keyset cursor 不重不漏 | `listInbox.in.cursor` / `out.nextCursor` | `inbox-load-more` | ✅ `list-inbox.test.ts` 分页 |
| V3 | `q` 只搜标题与编号 | `listInbox.in.q` | `inbox-search` | ✅ `list-inbox.test.ts` 过滤 ×2 |
| V4 | 条数一次给全、不受过滤影响 | `getInboxCounts` | `inbox-column-count-{stage}` / `inbox-kind-{kind}` | ✅ `get-inbox-counts.test.ts` |
| V5 | 非超管 withheld 而非 403 | `InboxSources.exception` | `inbox-exception-withheld-hint` / `inbox-drawer-body-withheld` | ✅ 两份单测「非超管 withheld」 |
| V6 | 系统异常无 `done`，不可拖进已完成 | —（结构性：`stageOf("exception", …)` 无 `done`） | `inbox-column-done` 对 `kind=exception` 无 drop | ✅ 契约测试 `stageOf` |
| V7 | 不做无理由被拒 | `triageFeedback` → `TRIAGE_REASON_REQUIRED`；`updateSystemErrorLifecycle` → `REASON_REQUIRED` | `inbox-decline-form` / `inbox-decline-reason` / `err-reason` | ✅ `inbox-smoke.spec.ts` ③ |
| V8 | 时间线 / GitHub 现查 / 建 Issue 复用 | `listFeedbackStatusEvents` / `getFeedbackGithubIssue` / `triageFeedback.issueDraft` | `inbox-drawer-timeline` / `inbox-drawer-github-loading` / `inbox-issue-form` | ✅ B3.5 8 条单测 |
| V9 | 深化 → 设计方案，双向关联 | `deepenFeedback`（`design-workbench.ts`） / `InboxItem.linkedFeedbackId` / `.resolvedByDesignId` | `inbox-action-deepen` / `inbox-action-open-design` | ✅ `list-inbox.test.ts` 接入 design |
| V10 | 关联标可点击跳转并高亮 | —（前端路由 `?open=<id>`，无新 API） | `inbox-drawer`（B3.7） | ⏳ B3.7 并行会话中 |

## 二、API → UC（反向：有没有多余的接口）

| API 操作 | 被哪条 V 要求 | 结论 |
|---|---|---|
| `listInbox` | V1 V2 V3 V5 V9 | 必需 |
| `getInboxCounts` | V4 V5 | 必需 |

**没有多余的操作。** 本束只有两条只读操作；V6–V8 要求的写操作全部是 `feedback-loop.ts` /
`system-error-logs.ts` / `design-workbench.ts` 的既有操作，本束复用而不重开入口。

## 三、门控命令（B3.8 E2E）

`apps/web/e2e/inbox-smoke.spec.ts`（`playwright.fullstack-smoke.config.ts`）：② 看板拖拽触发
真实迁移、③ 转不做需理由。① 「直接提交 → 收件箱自动开 drawer」由
`feedback-drafts-smoke.spec.ts` ② 覆盖到「反馈落在收件箱、待处理」。
