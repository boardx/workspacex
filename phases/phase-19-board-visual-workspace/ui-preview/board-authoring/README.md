# BV04/BV05 UI 截图索引（待采集）

当前目录没有本束截图。现有 `ui-preview/board-fabric-surface/s01-fabric-board.png` 仅覆盖 S01 Fabric 表面；设计参考图片与旧 mock 也不能证明 BV04/BV05 的正式编辑体验。主 session 拥有真实浏览器端到端验收与截图采集；这里没有伪造或复用图片。

采集前提：确认目标 SHA 与 `/studio/board/:boardId` 正式路由可达，按 `contracts/board-authoring/ui.md` 的状态矩阵操作；每张截图记录 viewport、权限角色、Board ID 脱敏标识、是否使用真实服务、可复现步骤和相应 trace。优先采集空板/编辑中、选中便签菜单、Text 层级、Tab 连续、批量 500 行校验、只读、保存失败、IME/RTL/长文本与窄屏软键盘。截图与 `ui.md` 的引用集合须双向一致。

现有代码仍把批量上限呈现为 100 行，且 BV04/BV05 的七态预览入口不存在；这些是实施与签核差距，不能靠截图命名掩盖。
