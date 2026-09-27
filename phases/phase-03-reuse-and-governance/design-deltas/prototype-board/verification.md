# verification · prototype-board

> 每条都写**反证**。编号接 V90。

## V91 — 契约：合法画布通过；连线指向不存在的元素 / 连向自己 ⇒ 拒；坐标出界 / 超上限 ⇒ 拒
`apps/web/tests/ui/prototype-board.test.tsx`「契约」两条。⚠ 反证：删掉 `BoardProps` 的 refine ⇒ 第一条红。

## V92 — 画布渲染：便签按中心坐标摆放、带署名与纸色；连线与光标画出来；读屏说得出内容
同文件「画布渲染」。⚠ 反证：`case "board"` 返回 null ⇒ 红。

## V93 — React 导出与画布同一套几何
同文件「React 导出」+ `prototype-react-export.test.tsx`「闭集全覆盖」（新增原语不补样例就红）。

## V94 — 给模型的说明覆盖 board 的每个字段，且在它自己那一段里
`packages/contracts/tests/design-prototype.test.ts`「PROTOTYPE_SCHEMA_GUIDE 覆盖每一个 props 键」。

## V95 — 质量门内容量把画布元素算进去；空画布照样扣
`apps/api/tests/design-workbench/prototype-quality.test.ts`「M1 内容量把画布里的元素算进去」。
⚠ 反证：撤掉 board 计数 ⇒ 12 张便签的页被判不满分。

## V96 — 纯图标按钮补文字；图标不在闭集里不补
`apps/api/tests/design-workbench/prototype-screen-repair.test.ts`「纯图标按钮补文字」。

## V97 — 属性面板不把 structured 字段写进草稿
`prototype-inspector.tsx` 的 `toDraft` / `fromDraft` 跳过 `structured`（与 `image` 同一条路）。

## 真实模型验收（qwen3.8-max，2026-09-27，结果落地前写了预测）
- 白板用例（桌面模板，2 轮）：每轮 4 页里 **2 页用上 board**（含便签、连线、协作者光标）；画出页 4/4、3/4（第二轮未画出的那页是纯图标按钮 `label:""`，已由 V96 修正；离线复算该页可收）。
- 非画布用例（心理学 App，2 轮）：**0 页**用 board——不滥用。
- 截图：`ui-preview/multiplayer.png`（多人实时协作）、`ui-preview/connect.png`（连线整理）。
