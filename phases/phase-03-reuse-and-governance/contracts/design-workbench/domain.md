# 契约束 `design-workbench` — 支撑材料：领域模型

> 补写材料（B4.6 之后由 doctor [03] 签核链检查要求补齐——`domain.md` 属于 ADR-023
> 决策二里"降级为支撑材料但不得删除"的一件，本文件之前缺失，非新的产品决策，
> 内容整理自 `packages/contracts/src/design-workbench.ts` 文件头 + 正文注释）。

## 1. 实体

| 实体 | 表 | 生命周期 |
|---|---|---|
| 设计项目 | `design_projects` | 创建后 `name`/`template`/`problem` 可被 owner 编辑；`pushed`/`pushedAt`/`note` 由推送操作写；硬删除（`deleteProject`） |
| 项目对话 | `design_project_chat_messages` | append-only，每次 `appendProjectChat` 原子写「用户消息 + 固定回执」两条 |

设计项目**没有状态机**——`pushed: boolean` 是它唯一的二态（不是像反馈那样的多态流转）。
进入收件箱之后的状态机属于 `InboxItem`/`system-error-logs`，是 `inbox` 契约束的领域，不在这里。

## 2. 双向关联：反馈 ↔ 设计项目

一条反馈「深化」出一个设计项目时：
- `DesignProject.linkedFeedbackId` = 源反馈 id；
- 该反馈对应的 `InboxItem.resolvedByDesignId` 在项目**推送**后回填为收件箱条目 id
  （`pushToInbox` 在同一事务里写 `product_feedback.resolved_by_design_id`，B4.2 的迁移
  与 B4.3 的用例实现；DB 层是一对外键 + 唯一约束，两个字段是它的读投影，不是两份事实）。

## 3. 可见性口径（与 `feedback-loop` 的 D3 对照）

设计项目**不走** `feedback-loop.ts` 的 D3 门控（提交人 + 超管可见）。选的是**组织内全员
可读，仅 owner 可改/删/推送**——完整理由见契约文件头【待确认点 1】。`listMyProjects` 的
「我的」是用户视角过滤（按 `ownerId`），不是权限边界；查看他人项目的读操作若将来需要，
是新增操作，不改这里的可见性口径。**这一条待人类在签核时确认**，见 `design-signoff.md`。

## 4. 推送幂等：upsert 而非拒绝重复

`pushToInbox` 的幂等键是 `projectId`（一个项目至多对应一条收件箱条目，B4.2 唯一约束）。
重复推送更新 `pushed`/`pushedAt`/`note`，`inboxCode` 保持不变。没有 `ALREADY_PUSHED`
错误码——完整理由见契约文件头「推送幂等选的是 upsert」。

## 5. 刻意没有的东西

- `chat[]` 独立查询接口——同 `FeedbackDraft.chat` 先例，直接嵌在实体投影里。
- 画布/原型内容字段——B5.3 明确 out of scope，`frames` 只是标签条文案。
- `PUT /pm-designs/:id/status`——设计方案没有状态机，不需要独立的状态迁移接口。

见契约文件（`packages/contracts/src/design-workbench.ts`）获取逐字段的完整头注。
