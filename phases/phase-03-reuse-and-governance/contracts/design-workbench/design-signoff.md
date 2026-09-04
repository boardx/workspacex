---
status: pending
confirmed_by: null
confirmed_at: null
bundle: design-workbench
scope: pm-design-workbench
covers: [R4.4]
---

# PM 设计工作台 —— 设计签核

规范来源：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-研发闭环-反馈到设计到排期.md`（R4.4）·
`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md`（B4 落地记录）·
`phases/phase-03-reuse-and-governance/ui-preview/feedback-design-loop/README.md`（取材记录）。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ⚠ 这是一次补签，不是先签后做

同 `inbox-unified` 束一样：B4.1–B4.4（契约、迁移、API、推送到收件箱、从反馈「深化」）
已通过 PR #2677/#2705 合入 `main`；B4.5（web 切真 API）视情况可能已在进行或已合入
（见对应 PR）。授权依据同上——`uc-17-8-go-live-backlog.md` §0 的范围裁决，不是本文件
要求的三件束级签核仪式。**后果同上**：本束 feature 不应标 `passing`，直到本文件
`status` 被人类明确改成 `confirmed`。

---

## ① UI

材料来源：`phases/phase-03-reuse-and-governance/ui-preview/feedback-design-loop/`
（`workbench-*`、`detail-*` 前缀）：
- `workbench-default`、`workbench-empty`、`workbench-new-dialog`、`workbench-new-invalid`
- `detail-canvas`、`detail-spec`、`detail-push-confirm`、`detail-push-success`

⚠ **这批截图是 mock store 时代拍的**（原型阶段，`detail-screen.tsx` 读
`design-loop-store.tsx`）。B4.5 把这两块屏切到真 API 后，若布局/态没有实质变化，
沿用这批截图升格为签核材料（同 `inbox-unified` 束的处理方式）；若 B4.5 引入了新的
loading/error 态（真 API 有网络失败的可能，mock store 没有），**这些新态需要补拍，
是 B4.6（backlog 条目）要做的事，不是本文件签核时臆造齐全**。签核时请明确：
现有 8 张是否足够覆盖真栈化后的实际状态，还是要等 B4.6 补拍后再签。

## ② 用例

规范：R4.4（PM 设计工作台：新建 → 对话深化 → 推送到收件箱，双向关联）。

- **对话面板的真实行为**（2026-09-04 补充说明，回应此前的产品提问）：左侧对话框
  发消息，真实调用 `appendProjectChat`，但**不接真实 AI**——D7 已裁决「先固定回执上线」，
  回执是写死文案，不理解消息内容，右侧画布/说明**不会**根据对话内容变化（画布本身仍是
  占位块，B5.3 明确排除在范围外）。这与"聊天驱动画布"的直觉预期有落差，**需人类确认**
  是否接受这个已知限制作为本轮上线的形态，还是要求画布至少读一部分对话派生的字段
  （problem/criteria）——后者是 B5.2（AI 协作，D7 裁决为后置独立束）的范围。
- **深化入口**（B4.4）：从收件箱条目「用 PM 设计工作台深化」按钮触发，`name`=标题、
  `problem`=正文、`template=wireframe`，幂等（同一条反馈重复点击不建重复项目）。

## ③ API 契约

见 `packages/contracts/src/design-workbench.ts`：`DesignProject` 实体 + 七个操作
（`createProject`/`listMyProjects`/`updateProject`/`appendProjectChat`/`deleteProject`/
`pushToInbox`/`deepenFeedback`）。双向关联（反馈 ↔ 方案）用
`design_projects.linked_feedback_id` / `product_feedback.resolved_by_design_id` 一对
外键 + 唯一约束表达，不存两份。

---

## 已知限制（签核时请重点核对，与「② 用例」呼应）

1. **对话不驱动画布**——见上，D7 已裁决的范围，这里只是把它摆到签核台面上而不是
   埋在代码注释里。
2. **画布仍是占位块**——原型阶段的「手机原型三帧」占位，B4.5 不升级它，B5.3 明确
   排除在范围外（backlog 原话：「原型画布从占位块升级为可编辑（PDF 明确 out of
   scope，仅登记）」）。

## 签核

`status: pending`。请在这里给出你的确认：

- [ ] ① UI 材料（是否需要等 B4.6 补拍）已核对
- [ ] ② 用例范围（含"对话不驱动画布"这一已知限制）已核对，接受或要求改动
- [ ] ③ API 契约已核对
