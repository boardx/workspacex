---
status: proposed
confirmed_by: null
confirmed_at: null
bundle: feedback-loop
scope: feedback-capture-and-triage
covers: [FB-2, FB-3]
---

# 反馈与迭代（采集 + 分诊）—— 设计签核

规范来源：[usecases.md](./usecases.md) · [domain.md](./domain.md) ·
[coverage.md](./coverage.md) · `packages/contracts/src/feedback-loop.ts`。
提案：`docs/proposals/PROP-FEEDBACK-LOOP-E2E-001.md`（FB-2 / FB-3）。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ① UI

**⚠ 第 ① 件的截图材料尚未产出，这是本束今天唯一挡着签核的东西。**

需要 `phases/phase-03-reuse-and-governance/ui-preview/feedback-loop/` 下的三块屏截图，
并在 `.harness/scripts/ui-material-map.json` 里声明目录，本文件同目录再补一份 `ui.md`
逐张引用（`lint-ui-material` 双向对账）。三块屏是：

1. **提交弹层**（`components/feedback/feedback-dialog.tsx`）——两个标签页
   「提交」/「我提过的」；类型两枚 chip；标题/正文带字数；
   一行显式的上下文说明；失败态明说「没有被保存」。
2. **入口**（`components/shell/icon-rail.tsx` 最下方常驻图标；<md 在顶栏）以及
   `/chat` 里两处按钮（消息头按 agent、挂载 chip 按 skill）。
3. **后台两列屏**（`components/admin/feedback-screen.tsx`）——状态分布条 + 左右两列 +
   分诊按钮（只出当前状态出得去的边）+ 转「不做」的理由输入。

⚠ **`ui.md` 与目录都还没建，是刻意的**：建了但目录为空会让 `lint-ui-material` 报
判定④「目录不存在 / 0 张 png」——那是一条**正确的红**，但把一条已知的红引入主干
没有价值。产出截图与建 `ui.md` 是同一次动作。

实现**已经落地并可运行**，所以截图是「对着真屏拍」而不是「先画原型」——
这与 ADR-003 的 UI 先行有出入，出入的原因写在下面「② 用例」的第一段。

## ② 用例

见 [usecases.md](./usecases.md)（UC-F1…UC-F4，验收线索 R1–R12）。

⚠ **本束的实现先于签核落地了**，这一点如实写在这里而不是掩盖：
人类在 2026-08-15 直接要求把反馈功能做出来，并当场裁了下面四条决策；
实现按那四条走。ADR-023 的顺序（先签后做）因此被打破一次。
后果是：**代码在分支上，feature 不得标 `passing`，直到本文件被签**。
如果签核时发现设计需要改，改的是已经写好的代码——这正是先签后做想避免的成本，
而这次由人类的时间顺序决定，不是实现方自己跳过了关卡。

## ③ API 契约

见 `packages/contracts/src/feedback-loop.ts`（五条操作）。

⚠ 本束**只声明「人主动提的」那一半**。「从消息级评价聚合出的改进建议」那九条
（`rateMessage` / `listSuggestions` / `getSatisfaction` / `getLoopMetrics` …）
在已签核的 `skills.ts` 里，本束不重新声明——那会是本项目第六次「同一事实两处声明」。

---

## 你已经裁过的四件（2026-08-15，本文件据此写成）

| 编号 | 问题 | 你的选择 |
|---|---|---|
| D1 | 后台反馈屏与 skill 屏的「改进反馈」画同一件事 | **后台屏唯一入口**；`skill-feedback.tsx` 降级为链接 |
| D2 | 反馈入口的形态 | **图标栏常驻图标**（原话：一旦要多点两下就没人提了） |
| D3 | 别人的反馈能看到多少 | **标题+票数全组织可见，正文仅管理员与提交人** |
| D4 | 第一版做不做附件 | **不做**，纯文字 + 自动上下文 |

D5（「人工复核人」角色）属于 FB-4，本束不涉及。

---

## 签核前请你确认的三件（这三条我做了决定，但它们是产品判断不是技术判断）

1. **`不做` 这个终态**。它不在原提案里，是我加的：没有它，「我们不打算做这条」的
   唯一表达方式是把它永远留在待处理里。它必须带理由，且提交人看得见那句理由。
   —— 你若认为「不答复好过一句被拒绝的理由」，那这一态要去掉。
2. **反馈类型只有 `缺陷` / `需求`，没有「其他」**。一个「其他」桶会装走一半的反馈，
   而分诊的人拿到「其他」时得到的信息量等于零。
   —— 你若确实需要第三类（如「体验」/「性能」），现在加比以后加便宜。
3. **状态流水没有查看界面**（coverage.md 缺口 1）。留痕在写，但今天只能直连库查。
   —— 你若认为「管理员要能在屏上看到这条反馈被怎么处理过」是第一版的一部分，
   那需要新增一条 `listFeedbackStatusEvents` 契约操作，本束要重签。

---

## 怎么签

把上面的 `status: proposed` 改成 `confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字>"
confirmed_at: "<ISO8601 时间戳>"
```

签之前请先答上面那三件——签了 status 但没答，实现方仍然卡在原地。
另：第 ① 件（截图 + `ui.md`）在签核前必须补齐，否则束级门控不会绿。
