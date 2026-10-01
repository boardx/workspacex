# verification · novice-progressive-disclosure

> 编号接 prototype-board 的 V97。

## V98 — 默认不摊开页面结构树，只有一句怎么改的提示；在画布上选中元素树才出现
`tests/ui/design-loop.test.tsx`「#4331 U2 默认不摊开图层树…」。⚠ 反证：改回编辑态常驻 ⇒ 红。

## V99 — 收进「更多」的动作都还够得着（菜单项沿用原 testid）
design-loop 单测里所有这些动作改为 `clickMore(testid)`；e2e 用 `e2e/support/design-more.ts`。
⚠ 反证：删掉任一菜单项 ⇒ 对应用例找不到 testid 红。

## V100 — 推送不再占顶栏，菜单里叫「交给开发排期」；顶栏主按钮是分享
`design-loop.test.tsx`「顶栏那颗实心按钮指的是「分享」…」。

## V101 — 画板视图不显示页签条，当前页由 `aria-current` 标出；单页视图有页签
`design-loop.test.tsx` 迭代 4 画板视图那条（聚焦第 2 页 ⇒ board-frame-1 `aria-current="page"`）。

## V102 — 普通用户评测集机器分
`pnpm run eval:novice-design`：详情页首屏控件数与术语两项的前后对比写进 PR。
