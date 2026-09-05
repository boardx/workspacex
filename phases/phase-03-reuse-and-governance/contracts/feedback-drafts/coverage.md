# 契约束 `feedback-drafts` — 支撑材料②：UC 覆盖证明

> 覆盖 feature：**B1.1 … B1.7**
> ⚠ **这一行是派生视图，不是权威。** 权威是 `design-signoff.md` frontmatter 的 `covers:`。
>
> 验收线索来源：`usecases.md` 的 **V1–V9**。

「前端消费点」列填**已建成界面**里的真实 `data-testid`
（`components/design-loop/drafts-screen.tsx` / `components/feedback/feedback-dialog.tsx`，已在仓库中核实）。

---

## 一、UC → API（R12 验收线索 V1–V9）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 空正文可存草稿 | `createFeedbackDraft.in.detail`（无 `min(1)`） | `feedback-dialog` 存草稿按钮 → `dialog-draft-saved-light.png` | ✅ `draft-lifecycle.test.ts`「空正文草稿可以建」 |
| V2 | 草稿不是反馈 | —（结构性：六条操作不触 `product_feedback`） | — | ✅ `draft-repository-guard.test.ts`「names no tenant table other than product_feedback_drafts」 |
| V3 | owner 私有；列表与徽标同口径 | `listMyFeedbackDrafts` / `getMyFeedbackDraftCount` | `drafts-list` / `draft-card-{id}`；导航徽标 `live-admin-nav-counts.ts` | ✅ `draft-lifecycle.test.ts`「别人看不到」 |
| V4 | 编辑追加不覆盖 | `updateFeedbackDraft.in.appendChat` / `detail` | `draft-edit-drawer` / `draft-edit-body` / `draft-edit-save` | ✅ `draft-lifecycle.test.ts`「追加一条 edit 记录」 |
| V5 | 继续完善 seed 一次 | `updateFeedbackDraft.in.appendChat`（`refineSeeded`） | `draft-refine-overlay` / `draft-refine-input` / `draft-refine-send` | ✅ 「首次 seed 一条固定 AI 澄清问题」 |
| V6 | 删除，附件回未认领 | `deleteFeedbackDraft` | `draft-delete-{id}` / `draft-edit-delete` | ✅ 「删除：附件回到未认领」 |
| V7 | 空正文提交被拒 | `submitFeedbackDraft` → `DRAFT_EMPTY` | `drafts-submit-empty-edit` | ✅ 「提交：空正文 ⇒ DRAFT_EMPTY」 |
| V8 | 提交成反馈，附件迁移，草稿消失 | `submitFeedbackDraft.out.feedbackId` | `draft-submit-{id}` / `draft-refine-submit` | ✅ 「提交成功…」+ `feedback-drafts-smoke.spec.ts` ①② |
| V9 | 草稿附件下载 owner-only | `downloadFeedbackAttachment`（`feedback-loop.ts`，B1.7 三分支） | 编辑 drawer 附件缩略图 | ✅ `draft-attachment-download.test.ts` 7 条 |

## 二、API → UC（反向：有没有多余的接口）

| API 操作 | 被哪条 V 要求 | 结论 |
|---|---|---|
| `createFeedbackDraft` | V1 | 必需 |
| `listMyFeedbackDrafts` | V3 | 必需 |
| `getMyFeedbackDraftCount` | V3（导航徽标不该为一个数拉整张列表） | 必需 |
| `updateFeedbackDraft` | V4 V5 | 必需 |
| `deleteFeedbackDraft` | V6 | 必需 |
| `submitFeedbackDraft` | V7 V8 | 必需 |

**没有多余的操作。** `structureFeedbackDraft`（语音转结构化）属 B2.4 / `feedback-loop` 束，
名字里带 Draft 但与本束的草稿实体无关，不在本表。

## 三、门控命令（B1.6 E2E）

`apps/web/e2e/feedback-drafts-smoke.spec.ts`（`playwright.fullstack-smoke.config.ts`）：
① 存草稿 → 列表 → 继续完善 → 提交 → 从列表消失；② 管理员在收件箱看到该反馈、待处理。
