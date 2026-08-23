# 契约束 `interaction-primitives` — 签核①：UI（界面落点）

> ## 🔴 自检（可机械核对）：**本文件引用 0 张截图，目录尚未产出。**
>
> 目录：`phases/phase-12-uiux-foundation/ui-preview/interaction-primitives/`
> **该目录现在不存在** —— ui-prototyper 尚未执行。
>
> ⇒ `lint-ui-material.mjs` 会对本束报判定④「目录不存在 / 0 张 png」。
> **这条红是本束的正确状态，不是待修的故障。**
> 已在 `.harness/scripts/ui-material-map.json` 补上本束的映射行。
>
> ⚠ 本文刻意不写任何**设想的**文件名。等 ui-prototyper 产出后，由它或后续 agent
> 把真实文件名填进下面的索引表。

## 该有哪些屏（文字描述，非文件索引）

- **Dialog**：默认态 / 打开态（含焦点落点可见的 focus ring）/ 长内容可滚动态 / 关闭动效帧
- **Dropdown Menu**：默认态 / 展开态 / 键盘高亮某一项 / 空列表态
- **Select**：默认态 / 展开态 / 已选中态 / 键盘导航中态
- **Tooltip**：hover 触发态 / focus 触发态
- **Table（若 F09 盘点确认收口）**：空态 / 有数据态 / 大数据量滚动态
- **Menu / Breadcrumb / Pagination（若确认收口）**：默认态 + 边界态（如面包屑层级过深、分页只有 1 页）

以上均在 `apps/web/app/kitchen-sink/page.tsx` 的新增展示区块中截图，不需要额外新建业务页面。

## 索引表（ui-prototyper 产出后填写）

| 状态 | 文件名 |
|---|---|
| ⚠ 未产出：Dialog 默认态 | — |
| ⚠ 未产出：Dropdown 展开态 | — |
| ⚠ 未产出：Select 键盘导航态 | — |
| ⚠ 未产出：Tooltip 触发态 | — |

> 覆盖 feature 与依据见 `design-signoff.md`（权威）。
