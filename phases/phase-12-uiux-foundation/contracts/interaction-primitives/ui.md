# 契约束 `interaction-primitives` — 签核①：UI（界面落点）

> ## ✅ 自检（可机械核对）：**本文件引用 5 张截图，目录下实际 5 张。**
>
> 目录：`phases/phase-12-uiux-foundation/ui-preview/interaction-primitives/`
> 由 ui-prototyper 用**真实组件**产出：在 `apps/web/app/kitchen-sink/page.tsx` 新增
> 「弹层原语」展示区，四个原语（Dialog / Dropdown / Select / Tooltip）均基于已在库的
> `@radix-ui/*` + 现有设计 token，可点、键盘可达，每个可交互元素带 `data-testid`。
> 截图脚本：`apps/web/scripts/shot-phase12-signoff.mjs`。

## 本轮范围与裁剪

- **只做 01 号需求（F01/F02）的四个弹层原语**：Dialog / Dropdown Menu / Select / Tooltip。
- **Table / Menu / Breadcrumb / Pagination（06 号需求 / F09 / F10）本轮跳过**——这是
  ui-prototyper 的显式裁剪决定，留待 F09 盘点确认收口后再补。人类签核时若认为需要
  提前看到这几个复合组件的落点，请在此提出。
- ⚠ **Select 的实现说明（设计决定）**：本仓依赖里**没有** `@radix-ui/react-select`。为不
  引入新依赖，Select 用已在库的 `@radix-ui/react-dropdown-menu` 的 RadioGroup 组合而成
  （见 `apps/web/components/ui/select.tsx`）。其键盘模型（↑↓ / type-ahead / Enter / Esc /
  焦点环）与原生 select 等价，足以作为键盘导航态的签核材料；若后续需要严格 combobox
  语义（可搜索 / 多选），应作为独立 design-delta 评估。

## 索引表

| 状态 | 文件名 |
|---|---|
| 四原语默认态（触发器静止并排） | f01-f02-primitives-default.png |
| Dialog 打开态（危险动作二次确认 + 影响范围） | f01-dialog-open.png |
| Dropdown 展开态（键盘高亮 + 危险项 danger 色） | f01-dropdown-open.png |
| Select 键盘导航态（展开 + ↑↓ 高亮某项） | f02-select-keyboard-nav.png |
| Tooltip 触发态（键盘 focus 触发，与 hover 等价） | f02-tooltip-focus.png |

> 覆盖 feature 与依据见 `design-signoff.md`（权威）。设计决定与待确认清单见
> `phases/phase-12-uiux-foundation/ui-preview/README.md`。
