# 契约束 `feedback-loop` — 签核第 ① 件：UI

> ## 自检（可机械核对）
>
> **本文件引用 6 张截图，目录下实际 6 张。N == M，无死链、无多列、无遗漏。**
>
> 这一行由 `.harness/scripts/lint-ui-material.mjs` 双向对账（引用集合 == 实存集合），
> 不是一句自述——写错了会红。

⚠ **B3.6（2026-09-04，旧屏退役）**：原「屏 D · 后台两列屏与分诊」一节（3 张图，
文件名前缀 `fb-admin-two-columns-{light,dark}` 与 `fb-admin-decline-reason-light`）已删除——
它拍的是 `components/admin/feedback-screen.tsx`，该文件已随旧屏退役删除，
`/platform-admin/feedback` 现在 301 到 `/platform-admin/inbox`。「后台两列屏与分诊」
这件签核材料现由 `inbox-unified` 范畴的 `/platform-admin/inbox`
（`design-loop/inbox-screen.tsx`）承接，理由与该屏的截图见
`.harness/instructions`（backlog uc-17-8 D2：新屏是三类来源统一投影，严格超集于旧屏）；
本束今天只保留屏 A/B/C 三块——「提交」这一半的签核材料不受影响。详见本目录
`design-signoff.md` 的「B3.6 重开」一节。

## 这些图是怎么来的（重要）

由 `apps/web/scripts/shot-feedback-loop.mjs` 从取材页 `/preview/feedback-loop` 拍摄，
**渲染的是生产同一份组件**（`FeedbackDialog` / `FeedbackButton`），
数据由脚本 `page.route()` 拦截 feedback 路由提供。

⚠ 所以图与生产的差别**只有数据，没有代码**。
复刻一遍界面来拍照是本仓最不该犯的错——签核签的是照片，上线的是另一份代码。

⚠ 数据是脚本里写死的固定集合，不连真库：截图脚本要能在任何机器上重跑出**同一张图**。
连真库的话图会随那台机器上的数据变，而签核签的是图。

重跑：
```bash
BASE=http://localhost:3187 OUT=<repo>/phases/phase-03-reuse-and-governance/ui-preview/feedback-loop \
  node apps/web/scripts/shot-feedback-loop.mjs
```

---

## 屏 A · 入口长在哪（UC-F1 步骤 1 / UC-F2）

D2 已裁：**图标栏常驻图标**，不是顶栏下拉里的一项。
同一张图里还有 chat 的两处按钮——它们是同一个组件（`FeedbackButton`）的两种 variant。

- ![入口 · 浅色](../../ui-preview/feedback-loop/fb-entries-light.png)
- ![入口 · 深色](../../ui-preview/feedback-loop/fb-entries-dark.png)

要看的三处：
1. 左侧图标栏**最下方**（分组之外、个人菜单上方）的「反馈」图标；
2. chat AI 消息身份行上的按钮——它挨着 👍/👎 但**不是**同一件事
   （前者对这个 agent 说话，后者对这一条回答打分）；
3. 已挂载 skill 的 chip 旁的按钮。

## 屏 B · 提交弹层（UC-F1）

- ![提交 · 产品级 · 浅色](../../ui-preview/feedback-loop/fb-dialog-submit-product-light.png)
- ![提交 · 产品级 · 深色](../../ui-preview/feedback-loop/fb-dialog-submit-product-dark.png)
- ![提交 · 目标是某个 skill](../../ui-preview/feedback-loop/fb-dialog-submit-skill-light.png)

要看的四处：
1. 标题随目标变（「对产品提反馈」/「对 Skill「会议纪要」提反馈」）——
   用户要知道自己在对谁说话；
2. 类型两枚 chip，**没有「其他」桶**（理由见 `usecases.md` §2）；
3. 底部那行**显式**的上下文说明（「将一并附带：当前页面 X · 版本 Y · 你的账号；
   正文只有组织管理员和你自己能看到」）——I-F1，收集了什么就说什么；
4. 标题或正文为空时「提交」是禁用态（图上即是）。

## 屏 C · 「我提过的」（UC-F1 步骤 6）

- ![我提过的](../../ui-preview/feedback-loop/fb-dialog-mine-light.png)

提交成功后**自动切到这一页**，刚提交那条标「刚提交」。
反馈的死法不是「没人提」，是「提了没人答」——状态放在需要另找入口才能看到的地方，
等于没有答复。

⚠ 未产出：深色态的「我提过的」。它与屏 B 深色态共用同一个弹层外壳与同一套 token，
本轮只拍浅色；要补的话是同一个脚本加一行。

## 屏 D · 后台两列屏与分诊——B3.6 已退役，见上方头注

原「屏 D」（3 张截图，UC-F4 / FB-3）拍的是旧 `feedback-screen.tsx`；2026-09-04
（B3.6，backlog uc-17-8）该屏与其截图一并删除。当时这里登记过的七处要点，
现由 `/platform-admin/inbox`（`design-loop/inbox-screen.tsx`）承接，对应关系：

| 旧屏（已删除） | 新屏 `inbox-screen.tsx` |
|---|---|
| 0. 右上角卡片/列表切换 | `inbox-view-board` / `inbox-view-list` 两态切换，语义相同 |
| 1. 状态分布条 | 看板视图四列各自计数（`inbox-column-count-{stage}`） |
| 2. 左列软件反馈/右列 Agent·Skill 反馈 | 三类来源（反馈/系统异常/设计方案）统一投影为一份列表，类型 chip 筛选（`inbox-kind-{f}`）取代左右分列 |
| 3. 分诊按钮只出当前状态出得去的边 | 同一不变量，`inbox-action-*` 按 `stage` 条件渲染 |
| 4. 无权正文显示权限说明 | `inbox-drawer-body-withheld`，同一条 D3 规则 |
| 5. 转「不做」先要理由，为空禁用 | `inbox-action-decline` → `inbox-decline-reason` / `inbox-decline-confirm`，同一条不变量 |
| 6. 聚合改进建议未接地，不展示聚合数字 | 该结构性事实未变，`inbox-screen.tsx` 同样不展示 |

⚠ **不是逐像素复刻**：新屏没有独立的「投票」入口——`inbox-screen.tsx` 的 drawer
只把票数当只读元信息展示（`FeedbackItem.votes`），不提供 `voteFeedback` 的界面
入口；也没有按来源（产品/Agent/Skill）单独筛选的 chip，只有类型 chip。
这两点差异记在这里，不在 `coverage.md` 里造一条新的"缺口"——它们是**设计选择**
（三类来源统一投影后，"来源"已经是 drawer 元信息的一部分，不再需要单独筛选层），
不是遗漏；若后续需要恢复，走 `inbox-unified` 范畴自己的契约签核，不回填这份
已退役的 `ui.md`。

新屏的截图材料不在本目录——它属于 `inbox-unified` 范畴（backlog uc-17-8 B3），
该范畴今天还没有独立的 `contracts/<bundle>/` 目录（尚待走 ADR-023 的契约签核流程），
所以这里只做**文字交叉引用**，不重复声明"已覆盖"，也不越权替它建一份材料。

⚠ 已删除：`[打开迭代看板]` / `[导出]`。UC-17.6 A1/A2 逐字「按钮存在，
但点击后无目标屏（原型待补）」——留一个点了会出现「实现者自己设计的看板」的按钮，
比没有按钮更糟，它会被当成已确认的设计继续长。新屏同样没有这两个按钮。
