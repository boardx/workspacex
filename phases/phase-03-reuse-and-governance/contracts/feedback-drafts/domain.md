# 契约束 `feedback-drafts` — 领域模型

> 支撑材料（ADR-023 决策二）。整理自契约 `FeedbackDraft` 头注、迁移
> `20260904130100_uc178_feedback_drafts.sql` 头注、`draft-ports.ts` 头注，不新增决策。

## 1. 实体

| 实体 | 表 | 生命周期 |
|---|---|---|
| 草稿 | `product_feedback_drafts` | 可反复改 `kind`/`detail`/`structured`；`chat` append-only；提交或删除即消失 |
| 附件（第三态） | `feedback_attachments.draft_id` | 未认领 → 挂草稿 → 提交时整体改挂反馈；删草稿时 `ON DELETE SET NULL` 回到未认领 |

### 草稿**不是**一条反馈

契约头注逐字：草稿没有状态机、没有票、没有 D3 可见性、没有 GitHub；不进
`product_feedback`、不计票、不进分诊队列、不进「我提过的」。进收件箱的**唯一**途径是
`submitFeedbackDraft`。所以是一张新表，不是 `product_feedback` 加 `is_draft`——反馈是历史事实
（正文非空 CHECK、不可变列触发器），草稿恰恰是可以反复改正文的东西。

### 对话是一列 jsonb（`chat`），不是子表

对话只在草稿存续期间有意义，提交时不进正文、删除时随之消失，没有按条查询的需求。
形状由契约 `FeedbackDraftChatTurn` 闭合；`updateFeedbackDraft` **追加不覆盖**（PDF §7）：
正文编辑追加一条 `{ role: "user", kind: "edit" }`，`detail` 才是当前值。

## 2. 谁能读写：owner 私有

- 任何组织成员都能建草稿；**只有 owner** 能列、改、删、提交、下载附件。
- RLS 只按 `app.current_org` 判（本仓所有租户表的既有约定）；owner 规则由仓储**每一条 SQL
  谓词** `owner_id = $n` 表达，`draft-repository-guard.test.ts` 解析源码守住。
- 非 owner ⇒ `DRAFT_NOT_FOUND`（404，不是 403）——不泄露存在性；附件下载同理（B1.7）。

## 3. 提交：三步顺序、每步各自原子

`submitFeedbackDraft` = ① `submitFeedback`（复用全部规则：标题派生、结构化字段、创建事件、
邮件）→ ② 一条 UPDATE 把附件整体改挂反馈 → ③ 删草稿。顺序保证任一步失败系统都处在
**可恢复、无悬空引用**的状态（最坏多一条草稿）；反过来先删草稿会让附件先回到未认领再也
迁不到反馈上。**不是**一个跨仓储的大事务（端口形状是「每方法一次 `withTenant`」，复制
`submitFeedback` 的落库/事件/邮件逻辑进一个大事务是任务明令禁止的）。

不变量：
- `detail` trim 为空 ⇒ `DRAFT_EMPTY`，草稿保留、没建反馈。
- 标题由服务端 `deriveFeedbackTitle` 派生（前端那份只是预览）。
- `attachmentIds` **不传**给 `submitFeedback`（附件由 ② 整体迁移）。
- 附件上限 `FEEDBACK_ATTACHMENT_MAX`（5），契约与用例层同一常量。

## 4. 「继续完善」的对话

首次打开浮层 seed **一条**固定 AI 澄清问题（`refineSeeded` 只置一次）；之后每条用户消息追加
一条固定回执。**接真 AI 属后置束 `design-ai-collab`**（D7 裁决后），本束不承诺。

## 5. 跨束交叉点（给阶段一致性复核用）

- **`feedback-loop`**：草稿的入口是快速反馈弹窗「存为草稿」（`feedback-dialog.tsx`，B2 改过的
  弹窗）；提交复用 `submitFeedback` 全部规则；`FeedbackKind`/`FeedbackTarget`/
  `FeedbackStructured` 三个类型共享；附件表 `feedback_attachments` 共享（多了 `draft_id` 一态）。
- **`inbox-unified`**：草稿**不出现**在收件箱；提交后的反馈以 `kind: feedback` 出现。
- **`design-workbench`**：无直接交叉（「去 PM 设计工作台」链接属 B2.5，归 `feedback-loop`）。
