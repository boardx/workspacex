---
name: ui-prototyper
description: >
  激活条件：用户提到 UI 先行、先做界面、UI 原型、界面确认、签核第一件、
  UI 关卡、把界面做出来给人看、has_ui 阶段等关键词时触发。
  在 feature_list 定稿前，用真实组件（apps/web + mock 数据）把本阶段界面做出来，
  写进束级 ui.md（签核第 ① 件的材料）后停下等人类确认。
---

# UI Prototyper Skill

## 何时使用

只用于 **UI 相关阶段（roadmap `has_ui: true`，由 `new-phase --ui` 标记）**，
且在 `feature_list.json` **定稿之前**。目标是把本阶段界面**先做出来给人类工程师确认**，
确认通过才进入代码开发。见 **ADR-003**。

> 视觉/交互标准不在这里复制，遵循 [uiux-designer] skill 与
> [uiux-standards.md](.harness/instructions/uiux-standards.md)。
> 本 skill 只讲「UI 先行」这一步怎么走。
>
> 视觉主张与设计计划方法（先出色板/字体/布局线框计划、对照需求剔除通用默认、再写代码）
> 遵循 [frontend-design](../frontend-design/SKILL.md) skill（来自 anthropics/skills，
> 2026-09-04 人类指令引入）。设计 token 仍以 `uiux-standards.md` 为单源。
>
> ⛔ **签核位置已变（2026-07-30，ADR-023 决策一）**：不再有 phase 级 `ui-signoff.md`
> ——那三份留档文件改了**没有任何效果**，全仓没有脚本读它。UI 是**束级**
> `phases/<phase>/contracts/<束>/design-signoff.md` 的第 ① 件，材料写在同目录 `ui.md`。

## 交付契约（本阶段的硬约定）

| 要求 | 说明 |
|------|------|
| **真实组件，非丢弃原型** | 直接写在 `apps/web` 里（`components/…` / 路由页），不是独立 mockup。人类确认后，feature 开发 = 把这些 UI 接上真逻辑，**UI 复用不重写**。 |
| **只用 mock 数据，不接后端** | 用本地假数据/固定桩渲染，**不写 API、不连 DB、不接状态同步**。这一步只交付「看得见的界面」。 |
| **可观测锚点** | 关键元素带稳定 `data-testid`，供后续 `feature_list.json` 的 `verification` 与 e2e spec 锚定（e2e 只认 `data-testid`，不锚文案/结构）。 |
| **严格类型** | 组件与 mock 数据全程 TypeScript 严格模式，**禁 `any`**（含后续 e2e fixture：用 `Page`、`PlaywrightWorkerArgs["playwright"]` 等真实类型，不写 `(page: any)`）。 |
| **截图存证** | 每块界面截图存 `phases/<phase>/ui-preview/`，在束级 `contracts/<束>/ui.md` 里贴相对链接。 |

## 能力清单（这个 skill 让你具备的动作）

- 读 `phases/<phase>/requirements/*.md`，把用户故事翻译成"需要哪些屏/组件"的清单，
  确保每条故事都有对应屏，不遗漏。
- 在 `apps/web` 用真实组件（非独立 mockup 项目）+ mock 数据实现界面，遵循
  [uiux-designer] 与 `uiux-standards.md` 的视觉/交互标准（本 skill 不重复这些规则）。
- 给关键元素打稳定 `data-testid`，为后续 `feature_list.json` 的 `verification` 与
  e2e spec 预留可观测锚点。
- 跑本地预览、逐屏截图，存入 `phases/<phase>/ui-preview/`。
- 写束级 `contracts/<束>/ui.md`（签核第①件材料）：路由 + 关键组件 + `data-testid` +
  截图引用；受 `lint-ui-material.mjs` 机械核对（引用集合与目录实存集合必须双向相等）。
- 束尚未切分时，把待确认清单写进 `ui-preview/README.md`，而不是自己发明束划分——
  束怎么切是契约设计问题，不是 UI 呈现问题，越界会制造后续需要撤销的既成事实。
- 识别"这一步该停下"的信号：材料齐了就停，不往前多走一步去碰 feature_list 或后端。

---

## 架构知识：这一步在「设计 → 签核 → 实现」链路里的位置

```
requirements/*.md ──▶ ui-prototyper（本 skill）──▶ 人类确认(束级 design-signoff.md ①)
                              │                              │
                              ▼                              ▼
                      apps/web 真实组件            requirement-author 生成 feature_list.json
                      + ui-preview/ 截图                    │
                              │                              ▼
                              └──────────▶ feature-implementer 接真逻辑（UI 不重写）
```

与相邻 skill 的分工边界（避免职责重叠、避免同一决策被两处做出）：

- **与 [uiux-designer] 的边界**：本 skill 决定"做哪些屏、覆盖哪些用户故事、
  截图存证"；uiux-designer 决定"这一屏做得够不够好"（视觉/交互标准的执行与自审）。
  两者常常是同一次实现里的两个视角，但判断标准不同，不要用本 skill 的完成判定
  （截图存证）替代 uiux-designer 的走查判定（是否符合美学与状态防御标准）。
- **与 [requirement-author] 的先后关系**：本 skill 先行、产出未定稿的"可确认物"；
  requirement-author 只能在人类把 `design-signoff.md` 改为 `confirmed` 之后，
  读"已确认 UI"生成 `feature_list.json`。顺序不可颠倒——颠倒等于 UI 方向在
  代码定稿之后才被人类看到，返工成本回到 ADR-003 想要消除的那个位置。
- **与门控脚本的关系**：`new-sprint`/`claim` 由 `.harness/scripts/lib/design-signoff.ts`
  的 `requiredBundleFiles()` 强制材料齐全性；本 skill 只负责把材料做对，
  不负责、也没有权限触发或跳过这道门。

---

## 领域/商业知识：为什么 UI 要先做、且必须是"真实组件"而非"丢弃原型"

**ADR-003 的核心动机**：界面方向在便宜的阶段（mock UI，改一个组件的成本）就被人类拍板，
把返工从"已定稿 feature + 已写代码"（贵）提前到"改 mock 界面"（便宜）。
"真实组件、不丢弃"的选择本身也是权衡结果：ADR-003 明确否决了"一次性可丢弃原型"方案，
理由是确认后要重写、浪费——所以本 skill 的产物直接是未来实现的地基,不是沟通用完即弃的草图。

**外部参照佐证这个方向**（design-to-code 与组件驱动开发的行业实践）：
- **"development-first components"**（Figma 官方最佳实践）：设计系统的新贡献应该
  先在设计工具里无框架地构思、拿到团队认可后再落成组件——这与"UI 先行、人类确认后
  再进入代码开发"是同一个思路的两种载体，只是本仓把"设计工具"换成了"真实组件 + mock"，
  因为最终交付本身就是代码，跳过一次转译。
- **组件驱动开发（Component-Driven Development）**：从最小可复用单元开始搭建、
  用变体（variant）覆盖交互态，再组合成页面——本 skill"先梳理屏/组件清单，
  再逐屏实现"的顺序与此一致，是给"标准流程"步骤 1-2 的方法论支撑。
- **"一次清晰的验收时刻"（sign-off moment）**：设计交接类实践普遍强调要有明确的
  "这部分已就绪可实现"的确认点，而不是让开发者自己去猜哪些是定稿的——本仓把这个
  验收时刻收敛成束级 `design-signoff.md` 的单一时刻（ADR-023），而不是像通用实践里
  那样可能散落在多次沟通中。
- **为什么"只用 mock、不接后端"是硬边界**：本仓已发生过 mock 手写、顺手创造出
  从未被评审的后端契约的先例（模型路由规则、组织类型策略、丢弃原因枚举都曾经
  只活在 `lib/mock/*.ts` 里）。UI 阶段接触真实契约会重演这个模式——所以"不接后端"
  不是效率考虑，是防止契约在没有评审的地方被发明。

参照：
[Figma development-first components](https://figma.com/best-practices/tips-and-tricks/make-your-design-system-work-better-for-everyone/development-first-components)、
[The Designer's Handbook for Developer Handoff](https://www.figma.com/blog/the-designers-handbook-for-developer-handoff/)。

---

## 标准流程

1. **读** `phases/<phase>/requirements/` 全部 `*.md`，梳理需要哪些屏/组件（覆盖每条用户故事）。
2. **建真实 UI**：在 `apps/web` 按 [uiux-standards.md] 高标准实现，mock 数据渲染，关键元素加 `data-testid`。
3. **本地预览 + 截图**：跑起 dev 预览，逐屏截图存 `phases/<phase>/ui-preview/`。
4. **填束级 `phases/<phase>/contracts/<束>/ui.md`**（签核第 ① 件的材料）：
   路由、关键组件与稳定 `data-testid`、逐条引用 `ui-preview/` 截图。
   ⚠ 束尚未切分时，先把待确认清单写进 `ui-preview/README.md`，**不要自己发明束**。
5. **停下等人确认**。**这一步你要做的到此为止。**

## 硬边界（这一步绝对不做）

- ❌ **不写 `feature_list.json`**：那是人类确认后 [requirement-author] 的活。
- ❌ **不接后端/不写业务逻辑/不做真实持久化**：只交付 mock 数据的界面。
- ❌ **不自己改 `design-signoff.md` / `design-coherence.md` 的 `status`**：确认是**人类工程师**的动作，不是 agent 的。
- ❌ **不跑 `new-sprint`**：束未签核时 `new-sprint` 与 `claim` 都会被门控拒绝（ADR-023），这是设计如此。
  `has_ui: true` 却没有 `contracts/` 目录的阶段同样被拒——先切束，别绕。

## 交接给谁

- 人类确认（把束级 `design-signoff.md` 的 `status` 改为 `confirmed`）后 → [requirement-author]：
  读 需求 + **已确认的真实 UI**（用其 `data-testid` 做可观察出口）→ 生成 `feature_list.json`。
- 排期 → [sprint-planner]；验证命令打磨 → [verification-writer]；实现（接真逻辑）→ [feature-implementer]。

---

## 迭代/进化机制

1. **谁踩坑谁回流**：本轮实现中撞到"束怎么切不清楚""某类屏无法用 mock 表达"
   之类的新问题，在同一 PR 里往本文件"硬边界"或"标准流程"追加一条具体说明，
   不要只在 PR 描述里说一句带过。
2. **与 ADR-003 / ADR-023 的一致性**：签核机制或束的产出结构变化时（历史上已发生过
   一次：phase 级 `ui-signoff.md` → 束级 `design-signoff.md` 第①节），
   本文件必须同步更新，且旧机制要显式标记停用（如本文件顶部的停用提示），
   不能留一份看似仍然有效但实际上脚本已经不读的说明。
3. **不复制视觉/交互标准的具体规则**：任何"这个组件该长什么样""该用哪个 token"
   类的问题，答案永远在 `uiux-standards.md`，本文件只讲"UI 先行"这一步骤本身怎么走
   ——重新抄一份规则等于制造第二份副本，本仓已因此漂移过至少一次。
