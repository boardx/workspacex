# verification · novice-workbench-list

> 编号接 novice-progressive-disclosure 的 V102。

## V103 — 卡片动作收进「⋯」，读屏名带项目名
`tests/ui/design-loop.test.tsx`「删除/编辑按钮的读屏名字带上是哪个项目」。⚠ 反证：改回写死的「更多操作」⇒ 红。

## V104 — 编辑 / 删除仍然走得通（删除先确认、失败提示由用户点掉）
`design-loop.test.tsx` 既有的编辑 PATCH 体、删除确认、删除失败三条改为经 `clickCardMenu` 打开菜单后照旧通过。

## V105 — 普通用户评测集：列表页首屏控件 11 → 8（预算 8），首屏术语清零
`pnpm run eval:novice-design` 的 `clutter.workbench` / `jargon.workbench`。
