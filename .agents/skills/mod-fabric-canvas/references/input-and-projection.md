# 输入、坐标与实时投影

源码根：`apps/web/components/whiteboard/`，以下组件路径相对此目录。

## 坐标诊断

- `fabric/board-fabric-object.ts` 管 viewport clamp/坐标 helper；CSS canvas 坐标从 DOM bounds 得到。
- Fabric viewportTransform 才把 scene/world 映射到 CSS canvas；React viewport 必须同时接收更新，
  否则 Fabric 图像移动了，DOM toolbar/handles 仍在旧位置。
- DPR 只用于底层 bitmap/像素采样，不能再乘到 CSS pointer 或 world 几何。
- `fabric/fabric-transform.ts` 用 calcTransformMatrix/qrDecompose 取得 world geometry。
  canonical 不表示 skew，拒绝不可表示变换而非悄悄丢弃；ActiveSelection 子对象 left/top 非 world。
- `drawing-coordinate-space.ts` 区分绘图 intrinsic 与对象 world transform，详见 drawing reference。

## 输入状态

`fabric/fabric-input.ts` 接受 Fabric 的 MouseEvent/TouchEvent/PointerEvent，匹配 active contact id；
不假定所有事件都是 PointerEvent。默认压力回退、primary/button、touchend changedTouches 见源码。
`fabric/board-pinch-viewport.ts` 锚点保持在手指 midpoint 下，结束/取消/换指后不能复用旧 session。
Surface 集成需在 pinch 结束后等待新 pointerdown 才恢复单指画/拖。

wheel 的当前行为在 Surface：无 Ctrl/Meta 平移，Ctrl/Meta zoomToPoint 锚定鼠标位置；
trackpad pinch 常由浏览器表示 Ctrl-wheel，不能根据 delta 小就宣称识别了硬件。
中/右键导航优先于创建；contextmenu、preventDefault、deltaMode、捕获与取消读实际 handler。
lostpointercapture、touchcancel、blur、Esc、dispose 必须结束临时手势/监听器，取消平移也要更新 React viewport。
`finishCancelledFabricTouch` 使用 Fabric 私有 teardown，需要版本升级测试，不自造半个 TouchEvent。

<a id="hand-与-canonical-refresh-的交互边界"></a>

### Hand 与 canonical refresh 的交互边界

2026-10-02 的精确修复来源是 [Nav commit 30432d5](https://github.com/boardx/workspacex/commit/30432d5224f880909aa6eadcf0ff3b00d83504e4)。
Surface 的 `pointerDown`、canonical reconciliation 与 tool effect 必须共同保持当前工具的
交互策略：Hand/Draw/Eraser 下 fresh 或 patched registry object 都不可重新 selectable/evented。
只在 `[readOnly, tool]` effect 关交互不够，后续 canonical refresh 会重新调用投影函数。
`current.selectable === readOnly` 也不是工具策略；Hand 的 false 与可写板的 false 相等，
会导致反复 patch 并恢复交互。策略以当前 tool/readOnly/hidden/kind 的真实状态为准。
Hand 导航开始时清 Fabric `_currentTransform`，与中/右键导航同类；否则 Fabric
在 own `mouse:down` handler 前建立的对象 transform 可能先移动一次目标。

原会议反例在 zoom 1.1 下手形拖过 Sticky，第一步屏幕位移 10/4 被写成 world
位移 9.090909/3.636364；后续 pan 正常不代表 canonical 安全。
该诊断来自旧 #5012 run 36946406305 artifact 11204743320 的 360 样本后 final reload，
不是缩短 timer 或移动 fixture 绕开对象得出的通过。
回归入口是 `board-fabric-surface.test.tsx` 的 noninteractive canonical-refresh/addition 与
stale-transform 用例；meeting spec 保留原 seed、360 样本、DB/权限和 final hash，
追加 hand-pan 后三客户端 canonical rows/hash 检查。4 个新用例有独立 RED→GREEN，
该来源记录 Surface/input/adapter/bridge 89/89；这些组件测试不等于会议长时浏览器已通过。

## 对象拖动与连接线

先区分 viewport 与对象 transform：纯 pan/zoom 使用共同 viewportTransform，所有 Fabric 对象和
connector 一起投影，world/canonical 几何不变，不应触发节点几何或 anchor 重算。
只有实际移动/缩放/旋转节点才使用下述 transformPreview 路径。

Surface `onTransformPreview` 派发临时 world geometry，editor `transformPreview` 驱动 DOM toolbar/handles。
Surface 同步预览 connector endpoints；adapter 最终从 `rotatedAnchorPoint` 求端点。
canonical offset 属于节点未旋转局部坐标，不能把已解析 world endpoint 当局部坐标再次旋转。
canonical geometry 的旋转基点是 top-left，不是 CSS 默认 center；DOM editor/chrome 的 inset
也要按同一局部坐标转成 world。读 `thinking-input-editor.tsx` 与上述几何 helper，不能只补 CSS angle。
权威数学在 [spatial geometry](../../../../packages/whiteboard-core/src/spatial-geometry.ts)；
实体旋转 bounds 读 [selection layout](../../../../packages/whiteboard-core/src/selection-layout.ts)，不要复制常量/公式。
拖动中不提交每帧命令；modified 时提交批次，拒绝/取消恢复最新 canonical 并清空预览。

`fabric/connector-interaction.ts` 当前使用 perPixelTargetFind、禁 bbox transform，避免透明连接线框
拦截下层 Sticky；新端点/路径手柄不要沿用整体对象矩形拖动。

本轮未合入 Connector 实现入口是 `connector-gesture.ts`、`use-board-connector-gesture.ts` 与
core `connector-path.ts`。路径以 resolved world geometry 绘制，不把 path 拉伸进另算的 bbox；
bbox 是 bounds/hit/cache 边界，不是第二个缩放坐标系。旧 route 缺省板保留兼容行为，不能为了
统一新路径模型静默改写旧数据。release 前读取最新 Y.Doc 对象并执行命令端 CAS/preconditions；
React render snapshot 或仅 UI 的 lock 检查不能消除远端删除、锁定、权限变化的提交窗口。

## Sticky 文字与字体

本轮未合入 helper `fabric/sticky-text-layout.ts` 是文字布局来源；Fabric 与 DOM 使用同一结果，
不复制 font-size 档位或内接几何公式。圆形使用实际最小直径确定内接文字范围；溢出编辑时要缩小
真实可滚动视口，而不是给整圆 textarea 加 padding（scroll 后文字仍会越界）。完整文字保存在
canonical，画布布局不应截断数据；最终长文本与窄屏验收仍分别记录。

`use-sticky-font-revision.ts` 与 Surface font refresh 只失效投影度量；font loading 不产生
canonical 写入，也不能重建 dirty draft 或丢 caret/selection。检查
`apps/web/tests/ui/sticky-font-editor-state-independent.test.tsx` 与 `board-sticky-text-layout.test.ts`。
上述 Sticky 新 helper/字体回归来自旧开发候选，不保证当前技能候选有这些文件；
待对应 PR/exact commit 来源可用再解析，缺失不表示技能迁移已携带业务实现。

## Group 与 chrome

FixedLayout + imperative canonical size 防止 Circle/文本 natural bounds 引发 FitContent 扩张。
控制点对象来自共享 prototype，改 mtr 前 clone，否则其他对象跟着改变。
`use-board-toolbar-position.ts`、chrome insets/fitRequest、ResizeObserver 三者需区分：
选择/菜单高度变化不该重新消费旧 fitRequest；新 request 或真实尺寸变化才重新 fit。
诊断 Fit 菜单时分别记录 request identity、真实 surface dimensions 与 chrome insets；
菜单开合只改变 chrome 时，保持旧 request 已消费的事实，而不是用布局变动当新用户 Fit。
源码入口是 Surface `appliedFitRef`/fit effect 与 `board-chrome-fit.ts`；
核实当前候选路径，既有 helper 不存在时不从这段经验复制第二套算法。
具体回归在 `9b67f2a6dc48acc48c061d0fd55e17f946b54301` 的 Surface test：
初 fitRequest1 为一次 onViewport；选择与 insets 改变仍一次；新 fitRequest2 为两次；
真实宽度变为 900 为三次；相同 resize 通知仍三次。它验证 request 消费策略，
不将菜单 chrome 变化视作用户新 Fit，也不代替浏览器无遮挡验收。
窄屏检查 root scrollLeft、菜单裁剪、按钮中心 `elementFromPoint`，仅菜单 bounds 在 viewport 不足以证明无遮挡。

## 单次创建

`fabric/fabric-creation-mode.ts` 与 Surface `creationActive` 暂停旧对象 hit/selection/evented，
不只关闭选框；否则点击旧对象不能创建。editor 完成创建回 Select，工具拖放使用
`board-tool-drag.ts` 当前协议。创建 armed 时隐藏旧 toolbar/connector handles，防止挡住 submenu。
`fabric-creation-mode.ts` 属于旧开发候选，当前技能候选缺失，以上是条件回归导航；
R04 当前实现和验收以其单独 PR/exact SHA 为准，不从迁移文档推断已完成。

回归入口：`apps/web/tests/ui/board-fabric-input.test.ts`、`board-fabric-coordinate.test.ts`、
`board-fabric-touch-teardown.test.ts`、`board-fabric-subpixel-transform.test.ts`、
`board-fabric-creation-mode.test.ts` 与 `packages/whiteboard-core/tests/connector-local-offset.test.ts`。
wheel 到 React viewport 的直接回归见 `apps/web/tests/ui/board-fabric-surface.test.tsx`；
DOM toolbar 映射见 `apps/web/tests/ui/board-toolbar-position.test.tsx`。
