# 契约束 `feedback-drafts` — 签核第 ② 件：用例

> 覆盖 feature：**B1.1 … B1.7**，见 `design-signoff.md` frontmatter 的 `covers:`（权威）。
> 规范来源：R4.2 + `uc-17-8-go-live-backlog.md` §B1 + `feedback-loop.ts`「UC-17.8 B1」一节。
> 验收线索编号用 `V`，`coverage.md` 以它们为行键。

## UC-B1-1 · 任何成员在快速反馈弹窗里「存为草稿」

**主角**：组织内任何成员。

1. 弹窗填了类型 / 正文 / 结构化字段 / 附件，点「存为草稿」而不是「提交」。
2. 服务端 `createFeedbackDraft` 落 `product_feedback_drafts`，附件挂 `draft_id`。
3. 弹窗给「已存为草稿」回执，导航徽标 +1。

**V1**：草稿允许空正文（先占个位）；`DRAFT_EMPTY` 只在提交时判。
**V2**：草稿**不**出现在收件箱、不计票、不进「我提过的」。

## UC-B1-2 · 我的草稿列表 + 导航徽标

**V3**：`listMyFeedbackDrafts` / `getMyFeedbackDraftCount` 只返回 owner 自己的；别人（含
管理员）看不到、数不到；列表条数与徽标同一口径。

## UC-B1-3 · 编辑草稿（drawer）

1. 改类型 / 正文 / 结构化字段，保存 → `updateFeedbackDraft`。

**V4**：正文改动追加一条 `edit` 对话记录，**不覆盖**原轨迹；相同正文不追加；四个字段都不传
是空操作（用例层原样返回）。

## UC-B1-4 · 继续完善（对话浮层）

**V5**：首次打开 seed 一条固定澄清问题（只一次）；用户每发一句追加用户消息 + 固定回执。

## UC-B1-5 · 删除草稿

**V6**：硬删；附件回到未认领（`draft_id` SET NULL）。

## UC-B1-6 · 提交草稿成反馈

**V7**：空正文 ⇒ `DRAFT_EMPTY`，草稿保留、没建反馈。
**V8**：成功 ⇒ 复用 `submitFeedback`（标题服务端派生、结构化字段随行、创建事件）→ 附件迁到
反馈 → 草稿消失 → 返回 `feedbackId` + `待处理`；从列表消失，收件箱可见。

## UC-B1-7 · 草稿附件下载（B1.7）

**V9**：owner 可下载；非 owner（含管理员）404 不泄露存在性；提交后落入既有 D3 反馈路径。

## 失败模式

| 场景 | 契约错误码 |
|---|---|
| 不是 owner / 不存在 | `DRAFT_NOT_FOUND`（404） |
| 提交空正文 | `DRAFT_EMPTY` |
| 第 6 个附件 | 契约 `.max(FEEDBACK_ATTACHMENT_MAX)` 拒 |
| 下游不可用 | `DEPENDENCY_UNAVAILABLE` |
