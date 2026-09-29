# 契约束 `board-authoring` — ① UI 待签核材料

> 覆盖候选：BV04（Sticky/Text 直接编辑与尺寸）、BV05（连续输入、批量、删除与基础 Undo/Redo）。这是待审 UI 材料，不表示束已签核或功能已验收。独立 mock 预览入口 `/preview/board-authoring` 已有[七态与窄屏浏览器截图](../../ui-preview/board-authoring/README.md)，但**没有可归属本束的正式 Board 路由截图**。不得用 mock 或旧 S01 Fabric 截图替代正式验收。

依据：`requirements/02-object-authoring.md#R1-R12`、`requirements/05-collaboration-history.md`、`design-deltas/2026-09-29-board-authoring-bv04-bv05-draft.md`。正式入口是 `/studio/board/:boardId`；`/preview/board-workspace` 的 mock 不能证明正式路由行为。浏览页保留 Studio 导航，进入编辑器后使用全屏内容区、紧凑顶栏与底部触摸 dock。

## 设计方向与可见交互

1. **空板先写想法**：双击空白或 `N` 立即创建默认便利贴，焦点留在便签本体。底部 dock 的便利贴按钮直接放置默认便签，展开面板再选方形、矩形、圆形与颜色；无需先填表单。`T` 或 dock 的 Text 入口直接创建行内文字。
2. **编辑仍像在便签上写字**：编辑控件覆盖 Fabric 便签内部的文本区域，保留便签颜色、纸张轮廓和空间位置；光标、选区、中文 IME 候选窗口清晰可见。不得跳到侧栏大 textarea 或让软键盘遮挡当前便签。编辑时全局 `N`、`Tab`、`Delete` 等快捷键不得抢输入事件。离开编辑态的保存中、失败、远端删除状态需要在对象附近解释。
3. **连续输入**：编辑一张便签后按 Tab 在 24px 间距处创建下一张并直接输入；无排列趋势时水平，明确纵向趋势时纵向。用户按住键、IME composition、只读角色或提交待确认时不得误增对象。完成十张后保持画布视角使新便签可见。
4. **所选对象的轻量菜单**：便签被选中时，简洁浮动栏只露出颜色、文字、复制、删除和更多；展开项再显示形状、字号、尺寸模式。Text 提供标题/正文/标签层级。长选项面板限制高度并滚动，不能盖住对象主体或底部 dock；Esc 关闭并返回触发按钮。精准尺寸进入右侧属性面板，而非一直占据画布。
5. **批量与粘贴**：多行粘贴提供“保留文字 / 按行生成便利贴 / 创建列表”的选择；独立批量输入保留原文本和行号预览。需求是 500 张一次语义操作，超限与无效行必须在创建前明确提示；确认前可取消，失败不丢原始输入。当前正式 UI 显示 100 行上限，这是验收差距，不得把它标成目标已达成。
6. **删除与撤销**：删除选中对象后给出简短可撤销反馈。Undo 恢复原对象身份和位置；Redo 再删除。连接或容器受影响时显示范围及明确确认，不做无提示的级联删除。

## UI 状态矩阵与可观察锚点

下表中的“现有”仅指当前代码中可定位的 DOM 锚点，**不是通过真实浏览器验收**。新增锚点是签核后开发要求；不得宣称现成组件已经实现它们。

| 状态 | 用户应看到 | 锚点/当前差距 |
|---|---|---|
| default | 空板双击/N 后对象内立即输入，底部 dock 和对象菜单分层清楚 | `board-live-surface`、`board-thinking-editor`、`board-tool-picker` 已有；需截图和计时 |
| loading | 全屏骨架与返回入口，尚不能输入 | 待增 `board-authoring-loading`；不能借“空板”代替 |
| empty | 清楚提示双击或 N 开始，真实零对象 | 待增 `board-authoring-empty`，正式路由截图缺失 |
| validation | 500 行超限、空行/无效输入显示行级反馈且原文保留 | `board-bulk-text`、`board-bulk-apply` 已有，但当前提示 100 行；需改后截图 |
| dependency failure | 写入/协作依赖失败时便签草稿保留，可重试且未假称已保存 | 待增 `board-authoring-dependency-failed`，正式路由截图缺失 |
| denied | Viewer/Commenter 可以阅读、选择；创建/编辑/删除入口禁用且有原因 | `board-command-availability` 可见，正式只读截图缺失 |
| success | 已选便签的浮动栏、属性变更与保存状态一致；Text 层级清楚 | `board-object-quick-actions`、`board-sticky-inspector-style`、`board-inspector-text` 已有；需真实截图 |

额外必须出图的边界：IME composition 中、RTL/长文本、窄屏与软键盘、Tab 连续十张后的视角、粘贴 500 行预览、Delete→Undo 后同一 id 的可见对象。截图需注明 URL、viewport、Board 角色、代码 SHA、状态来源和是否接真服务；mock 截图必须标成 mock。

## 签核前必须裁决

- **尺寸单源**：需求称 normal/free/auto-height；现有 `StickySizingMode` 是 fixed/auto-size/auto-height。[③草案](api.md)建议把 normal/free 定义为拖拽约束，保留现有持久尺寸枚举；圆形/方形自动高度及拖动后优先级仍须签核与验证。
- **工具栏位置**：`02-object-authoring.md#R8` 仍写左侧一级工具，2026-09-26 已有底部 dock 设计增量。须将正式 UI 方向归一，不能同时让两套高频工具抢画布。
- **截图与七态**：当前仅有 S01/其他 preview 截图，没有本束逐状态真实渲染。主 session 需在正式路由采集并对照上述矩阵；未齐前① UI 不能视为已签。
- **可访问性与触摸**：键盘焦点、Esc 还原、48px 触摸区、reduced-motion、320/375/768/1280px 和软键盘遮挡须由主 session 实测。

`ui-preview/board-authoring/README.md` 是 mock 预览图像索引与正式路由缺口记录。图像均由本地浏览器渲染，标为 mock；它们只支持① UI 方向评审。

2026-09-30 主 session 已在本地 mock 预览的浏览器中检查：七态切换均可见；500 行预览可确认、501 行显示超限并禁用确认；Tab 创建下一张并进入对象内编辑；创建后的 Undo/Redo 使对象数 3→4→3→4。曾发现 695px 视口的便签碰撞和双层焦点框，预览已修正并重新截图查看默认排列。以上是**设计预览**证据，不证明正式路由中的 Fabric/Yjs、权限、事务、持久化或 9/10 视觉验收。
