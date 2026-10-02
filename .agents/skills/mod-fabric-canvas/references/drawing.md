# 绘图、压力与擦除

源码根：`apps/web/components/whiteboard/`。工具视觉的单源是 `drawing-tool-style.ts`；
绘图 schema/预算在 `packages/whiteboard-core/src/content-object-model.ts` 与 contracts，
不要在菜单、preview 和 commit 各维护一套 style。

## 坐标和 frame

`drawing-coordinate-space.ts` 的 worldStrokeToDrawingSpace 逆旋转/缩放，把新笔画放入既有
intrinsic plane；geometryForAppendedDrawingStroke 只扩张超出旧 bounds 部分并补偿 world offset。
这使追加笔画/eraser 不重缩放或平移历史 centerline。
width 是 scalar，非均匀缩放有数学限制；helper 保守限制最宽轴，不能声称完全各轴精确。

`fabric/drawing-stroke-path.ts` 生成一次填充轮廓，不对 Highlighter 每小段分别透明合成。
压力是笔迹宽度输入；笔迹一次 alpha 与不同笔迹交叉累计 alpha 不是同一个指标。
Surface live preview 与落盘后 renderer 应走同一 path helper，避免最终效果跳变。

Group natural bounds 包含笔尖厚度。当前 renderer 固定 intrinsic frame，child pathOffset 对齐
intrinsic center；不能用自然 bounds 的中心作为历史点坐标系。
`fabric/drawing-cache-bounds.ts` 只扩 cache，保护 canonical frame 外的 round caps。
它覆盖 Fabric 私有 `_getCacheCanvasDimensions`；Fabric 版本更新需真实像素回归，不能仅 typecheck。

## 擦除

`fabric/drawing-hit-test.ts` 只命中 unlocked drawing，使用变换后的 stroke 几何；
不能用所有对象 bbox 命中，不能删除 Sticky/Shape/Image，也不能凭当前选中对象猜 target。
drawing 的 objectCaching 保持独立透明合成层，destination-out 只擦同 drawing 的 ink，
不得穿透把下层对象擦空。erase layer 的 targetStrokeIds/顺序语义以 core helper 为准。

editor `commitDrawing` 完成时重新 readObjects(doc)，忽略已删除/锁定/非 drawing 对象，
一次 execute 提交所有命中的 geometry+content extension，确保多对象一次 undo。
fitDrawingStrokeToExtensionBudget 后也要验证保持边界，不用超预算输入强写 Yjs。

## 最小证据

- 新 pen centerline 与旧点 world 坐标不变，覆盖 resize/rotate/追加超界笔画。
- round caps、压力粗细、Highlighter 同笔 uniform alpha、交叉 alpha、刷新后的 bitmap。
- eraser hole 显示原来下层颜色，不是清空背景；多对象一步 undo、空命中、锁定对象不变。

单测：`apps/web/tests/ui/board-drawing-coordinate-space.test.ts`、`board-drawing-stroke-path.test.ts`、
`board-drawing-cache-bounds.test.ts`、`board-drawing-hit-test.test.ts`。
浏览器：当前 [导航/绘图像素验收](../../../../scripts/local-session/board-navigation-acceptance.mjs)。
旧分支 `board-highlighter-pixel-acceptance.mjs` 是条件入口，不假定迁移候选含该脚本。
R01 验证显式 Highlighter 25% 样式，不接受默认透明度；R05 专门修默认值和 Draw UI。
默认外观单源必须同时进入菜单选择、live preview 和 commit；仅修改 style 表不能证明
旧 appearance state 不再覆盖它。技能不复制默认颜色/数值，读取 `drawing-tool-style.ts`。
