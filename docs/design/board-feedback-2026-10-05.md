# 白板截图反馈 backlog

来源：2026-10-05 用户提供的十张截图与口述。此次为直接交办的整体体验修复，一份 issue、一个 PR；下表不是 feature passing 或人类签核记录。

| ID | 反馈与目标 | 验收 |
| --- | --- | --- |
| B01 | 底部工具栏去除可见文字，统一图标；所有展开箭头位于图标右侧 | 鼠标提示与无障碍名称保留；工具仍可选择、展开 |
| B02 | 便利贴拖拽预览只显示便利贴，不拖整个菜单内容 | click/drag 各创建一次，取消不创建 |
| B03 | 形状评论标记采用专业、清晰的图标与数量呈现 | 数量、点击与对象定位正确 |
| B04 | 所有子菜单跟随母菜单触发器定位 | 视口碰撞时翻转/限位；缩放、平移和窄屏不漂到远端 |
| B05 | 重设计笔工具面板，采用紧凑、统一、克制的视觉 | 工具、颜色、粗细能直接预览与选择 |
| B06 | 橡皮擦扩大面积，显示白板擦形状并实时呈现擦除 | held 预览、release 一次事务、cancel 恢复、undo/redo；只擦可编辑绘图 |
| B07 | 多选绘图只有一个更多菜单；网格、整理、布局改用统一图标 | 操作可辨识，菜单与选区相邻 |
| B08 | 明确 AI 整理为按主题整理便利贴，预览后确认 | 非便利贴选区不能误触；不把普通布局伪装成 AI |
| B09 | 修复拖拽连接线偶发创建失败 | 四侧重复拖拽、取消后再连接、平移/缩放；端点绑定与历史正确 |
| B10 | 连接线宽度改用不同粗细线段预设；去除数字 2；线型/端点图标清晰 | 修改颜色作用于线与箭头；undo/redo 保持样式 |
| B11 | 对象外观面板专业化，颜色使用已有单源，粗细/线型/圆角直接可视化 | 消除原生蓝色控件；文本与对象颜色一致；精确位置尺寸仍可编辑 |
| B12 | 修复 docking 等距标注位置 | 数值出现在实际间距旁，跟随 viewport，避免固定屏幕边缘 |

并行 ownership：菜单与工具栏、绘制与对齐、连接线、外观与评论。共享 editor 由菜单 worker 独占；Fabric surface 由绘制 worker 独占，其他 worker 提供集成片段。所有修改在隔离候选树上共同验证，主 checkout 的既有改动不纳入此次交付。

## 验证与交接

- 对应统一 issue：https://github.com/boardx/workspacex/issues/5355。
- `./init.sh`：通过。
- `pnpm --filter web typecheck`、`pnpm --filter web lint`：通过，含完整设计 token 门。
- `pnpm --filter web exec vitest run tests/whiteboard tests/ui/board- --maxWorkers=2 --minWorkers=1`：134 文件、945 测试通过，包含实际 Chromium 笔迹像素回归。
- `pnpm --filter @repo/whiteboard-core exec vitest run`：23 文件、281 测试通过。
- 独立源码 review：初轮发现顶部浮层不可见和缩放后擦除光标不更新，修正后复核无剩余阻断项。
- 最终截图复核修复不存在的 `--foreground` token 导致的原生蓝色滑杆，以及外层面板被焦点滚动的标题裁切；增量 3 文件、22 测试通过，完整 lint 再次通过。
- 最终真实浏览器 14/14 验收通过：包括 10 次连接拖拽、松手前擦除像素变化与 canonical 不变、取消/撤销/重做、桌面/窄屏浮层、评论/外观、实际拖动时两处 120px 等距标注的世界间隙中点。应用源码 SHA256 manifest 在运行前后冻结一致。
- 命令输出与浏览器截图在 `evidence/whiteboard-feedback-2026-10-05/`；浏览器可复跑入口在 `apps/web/tests/whiteboard-feedback-browser/`。

浏览器使用生产 `CollaborativeThinkingEditor` 与真实 Fabric 投影、内存 canonical Yjs，验证真实 pointer、native drag、菜单位置与像素。它不证明远端 API 持久化、鉴权、WebSocket 或页面刷新恢复；此次没有改动这些后端路径。评论视觉使用明确限定的列表请求替身。未进行 Apple 实机触控板/系统 IME 测试。

本次直接交办不更改阶段 feature 状态或设计签核；CI 当前状态以唯一 PR 的实时检查为准。原共享主 checkout 的既有未提交改动仍由其原 owner 负责，本次仅提交隔离候选树中的白板反馈文件。没有创建 Docker 栈。交付后关闭自有浏览器/开发服务，停止 tick 并释放本次协调租约。

PR CI 发现绘制浮层与 dock 间距不满足原几何断言。修复使用母 dock 外框和完整 border-box 高度；375/1536/1672 单元回归通过，1440/390/1536/1672 浏览器实测均保持 8px 间距，保留原 CI 判据。

全栈 CI 的旧色板宽匹配与原生 DragEvent fixture 已更新：精确角色定位并点击色块，读取服务端 canonical 导出验证颜色；连接线使用实际鼠标按下/移动/释放，保留端点、删除保留和 reload 持久化断言。未放宽完成判据。
