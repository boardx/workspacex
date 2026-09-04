---
status: pending
confirmed_by: null
confirmed_at: null
bundle: inbox-unified
scope: unified-inbox-triage
covers: [R4.3]
---

# 统一收件箱 —— 设计签核

规范来源：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-研发闭环-反馈到设计到排期.md`（R4.3）·
`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md`（D1–D8 裁决、B3 落地记录）·
`phases/phase-03-reuse-and-governance/ui-preview/feedback-design-loop/README.md`（取材记录）。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ⚠ 这是一次补签，不是先签后做

这一束的实现已经先于本文件落地了：B3.1–B3.5（契约、聚合、系统异常状态、web 切真 API、
GitHub 徽标）已在 2026-09-04 通过 PR #2660/#2671/#2674 合入 `main`。授权依据是
`uc-17-8-go-live-backlog.md` §0 记录的人类原话「follow 你的建议，执行吧」（对 D1–D7
七个范围问题的裁决），但那次授权覆盖的是**范围问题**，不是本文件要求的三件束级签核
仪式——ADR-023 的顺序因此被打破一次，与 `feedback-loop` 束 2026-08-15 那次同类情况
（见该束 `design-signoff.md`「② 用例」一节）处理方式一致：如实记录，不假装顺序没乱。

**后果**：本束相关 feature 在 `feature_list.json` 里即便验证脚本全绿，也不应标
`passing`，直到本文件的 `status` 被人类明确改成 `confirmed`。

---

## ① UI

材料来源：`phases/phase-03-reuse-and-governance/ui-preview/feedback-design-loop/`
（`inbox-*` 前缀，README 里"七态覆盖"一节列了全部截图与对应态）。

⚠ 该目录当时是**取材记录**，不是正式签核材料（README 原话：「这里是待确认清单，不是
签核本身……束尚未切分」）——现在束已经切分（本文件本身就是切分动作的一部分），
这批截图**升格**为本束第①件的签核材料，不需要重拍：`inbox-screen.tsx` 从 mock 切到
真 API（B3.4）之后，视觉与七态覆盖没有变化，只是数据源换了。

七态齐全度：`inbox-board-light/dark`（默认）、`inbox-empty`（空）、`inbox-loading`
（加载）、`inbox-decline-invalid`（校验失败）、`inbox-depfailed`（依赖失败）、
`inbox-denied`（无权限——⚠ 见下方「已知偏差」，这张截图对应的其实是设计时的预览态
开关，不是真实 403 的落地态）、`inbox-success`（成功横幅）。另有 `inbox-board-draghover`
（拖放悬停）、`inbox-drawer`（详情贴边）、`inbox-list`（列表视图）。

## ② 用例

规范：R4.3（统一收件箱：三类来源投影 + 四态状态机 + 看板/列表 + drawer）。

沿用 `uc-17-8-go-live-backlog.md` §0/§0.1 已裁决的范围：
- **D2（采纳，替换）**：新收件箱替换旧 `/platform-admin/feedback` 三 tab 屏，不并存——
  这正是本束存在的理由（同一状态机不能两处声明）。**替换动作本身是 B3.6，本文件签核
  时尚未执行**，`feedback-screen.tsx` 现在仍在，束落地与旧屏退役是两个独立 PR。
- **D6（采纳，本轮不做）**：系统异常「仅平台运维可见」暂不恢复，收件箱按组织管理员
  视角，非超管时 `sources.exception: "withheld"`（静默跳过，不报错）。
- **D8（未裁决，待人类）**：非管理员访问收件箱时的真实行为是 `dep-failed`（通用失败态，
  见下方「已知偏差」），不是 `denied`——这与 `feedback-design-loop/README.md` 原型阶段
  设想的「拒绝访问专属态」不一致，此偏差记在这里，不影响本文件其余部分签核。

## ③ API 契约

见 `packages/contracts/src/inbox.ts`：`InboxItem`/`InboxKind`/`InboxStage`/`stageOf()` +
`listInbox`/`getInboxCounts` 两条只读操作。状态迁移**不**在本束新建接口，继续复用
`feedback-loop` 束的 `triageFeedback` 与系统异常束的 `updateSystemErrorLifecycle`——
本束的契约只声明「聚合视图怎么读」，不重新声明「状态怎么改」（同一事实不两处声明）。

---

## 已知偏差（签核时请重点核对）

1. **`denied` vs `dep-failed`**：`inbox-screen.tsx` 的 `data-testid="denied"` 只接**开发预览
   态覆盖**（URL `?state=denied`，`resolvePreviewState` 生产环境恒 `default`），从未真的
   接过 403。真实的 `canTriage` 403 落地是通用失败态 `dep-failed`（"收件箱数据暂时读不到"），
   不区分权限不足与其他失败原因。UI 先行阶段的 `inbox-denied-light.png` 截图因此对应的是
   一个**从未被真实数据触发过**的态。**需人类确认**：是否要在真实 403 时也走专属的
   「无权限」文案（新增区分 `dep-failed` 的两个子态），还是接受当前的统一失败态。
2. **B3.6（旧屏退役）与本文件的关系**：见「① UI」「② 用例」——本束的实现（B3.1–B3.5）
   已完整落地且可用，但旧屏尚未退役，新旧并存是当前真实状态，不是最终形态。

## 签核

`status: pending`。请在这里给出你的确认（同 `feedback-loop` 束先例，口头/文字授权由
agent 代转录，标明"由 agent 代转录"）：

- [ ] ① UI 材料（含"已知偏差 1"）已核对，接受或要求改动
- [ ] ② 用例范围（D2/D6/D8 现状）已核对
- [ ] ③ API 契约已核对
