---
status: pending
bundle: feedback-drafts
scope: feedback-drafts-private-staging
covers: [B1.1, B1.2, B1.3, B1.4, B1.5, B1.6, B1.7]
---

# 反馈草稿 —— 设计签核

规范来源：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md`
§B1 · 需求 R4.2（`uc-17-8-研发闭环-反馈到设计到排期.md`）· `packages/contracts/src/feedback-loop.ts`
「UC-17.8 B1 · 反馈草稿」一节。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ⚠ 本文件是补签，不是先签后做——如实写在这里

`feedback-drafts` 此前**没有** `contracts/feedback-drafts/` 目录：B1.1–B1.5、B1.7 已在
PR #2660 与后续 sprint 真栈化并合入 `main`（backlog §0.2），B1.6 E2E
（`feedback-drafts-smoke.spec.ts`）已在仓库。本文件是 B6.2 要求的产物才第一次建出来——同
`design-workbench` / `inbox-unified` 两束的补签情形。

**五件材料没有新造决策**：全部整理自契约文件头注（草稿不是反馈、owner 私有、对话追加不
覆盖、附件 `draft_id` 第三态、标题服务端派生、对话不进正文）、迁移
`20260904130100_uc178_feedback_drafts.sql` 头注（新表而非 `is_draft` 列、owner 谓词在应用层）
与 `submit-feedback-draft.ts` 文件头（事务边界诚实版）。

---

## ① UI

见 [ui.md](./ui.md)：9 张截图（草稿列表 / 编辑 drawer / 继续完善浮层 5 张 + 草稿入口所在的
快速反馈弹窗 4 张），由 `shot-feedback-design-loop.mjs` 渲染生产组件
（`components/design-loop/drafts-screen.tsx` / `components/feedback/feedback-dialog.tsx`）。

⚠ `dialog-*` 四张同时是 B2（快速反馈弹窗真栈化，归 `feedback-loop` 束）的材料；B2.6 重拍
`feedback-loop` 束截图时若把它们搬走，本束只需改引用，不复制图。

## ② 用例

见 [usecases.md](./usecases.md)：七条用例、验收线索 V1–V9。

## ③ API 契约

`packages/contracts/src/feedback-loop.ts` 的六条操作：`createFeedbackDraft` /
`listMyFeedbackDrafts` / `getMyFeedbackDraftCount` / `updateFeedbackDraft` /
`deleteFeedbackDraft` / `submitFeedbackDraft`。B1.1 backlog 原文就把它们放在 `feedback-loop.ts`
（`FeedbackDraft` 与 `FeedbackItem` 共享 `FeedbackKind` / `FeedbackTarget` /
`FeedbackStructured`），不另起文件——`lint-third-artifact` 形态 A，映射
`third-artifact-map.json`：`feedback-drafts → feedback-loop`。

---

## 签核前请人类确认的三件

1. **事务边界**：契约头注写「事务内删草稿 + 建反馈 + 迁附件」，实现是**三步顺序、每步各自
   原子**（`submit-feedback-draft.ts` 文件头「诚实版」）——最坏情况多一条草稿，绝不丢反馈或
   附件。是否接受这个边界，还是要求为它引入跨仓储共享事务的端口形状。
2. **对话不进反馈正文**：提交时正文 = `detail` 当前值，「继续完善」的对话记录随草稿消失。
3. **B6.6 数据保留**：草稿 30 天未动自动清理——期限待人类确认，本束未实现。
