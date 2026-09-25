# Panel、层级与 Connector

## R1 用例
编辑者把散落对象组织为 Panel/Frame/Group，并用独立 Connector 表达关系。

## R2 前置与触发
Board 中存在或可新建对象；用户通过 Panel/Arrow 工具、拖入容器、选区成组或从连接点拖出触发。

## R3 主流程
1. Panel 支持标题、背景、边框和 Freeform/Grid/Flow 三种模式。
2. 对象拖入/拖出 Panel 时以 parentId/orderKey 更新结构；移动 Panel 带动子对象，子对象世界坐标保持可解释。
3. Group 用于共同变换；锁定对象不能被移动/编辑；层级支持前后移动和明确 stacking order。
4. 从对象连接点拖出创建独立 Connector；端点绑定对象 id 和锚点，移动/resize 后连线自动更新。
5. Connector 支持直线/折线/曲线、起止箭头、颜色/粗细/虚线和可编辑 label。

## R4 备选与异常
- A1：连接拖到空白处可取消，或按明确 UI 创建新对象后连接。
- A2：删除端点时按用户动作选择删除 Connector 或保留为自由端点，结果可撤销。
- E1：禁止循环 parent、对象自连接的非法变体和重复 id；拒绝整个无效 operation。
- E2：远端移动与本地连接同时发生时按对象 id/anchor 重算，不持久化旧像素端点。
- E3：锁定、只读或跨 Board 对象不能成为未授权修改目标。

## R5 权限
Editor/Owner 可改结构和连接；Viewer/Commenter 只读；锁定不替代 ACL，解锁仍需写权限。

## R6 后置与不包含
层级、顺序、端点和 label 在领域模型/Yjs 中可查询；Fabric Group/Path 仅为投影。本轮不含完整 BPMN/UML 语义库。

## R7 业务规则
- Connector 是独立一等对象，不嵌入 source/target Fabric object。
- Panel membership 使用稳定 id，不能靠几何包含结果作为持久化事实。
- 所有坐标在 world space 统一，viewport 变化不改结构。

## R8 界面线索
Panel 标题/边界清晰；对象 hover 显示连接点；有效吸附高亮；结构变更有即时反馈。

## R9 非功能约束
移动含 1000 子对象的 Panel 不逐对象写 1000 个无关联 transaction；连接重算保持交互流畅。

## R10 依赖
对象层级 schema、几何/锚点算法、Fabric registry、Yjs transaction。

## R11 切分
第 3 轮：Panel 模式、membership/坐标、group/lock/layer、Connector model、routing/label。

## R12 验收线索
PRD Panel 与 Diagram 旅程必须在双浏览器中保持成员关系、移动同步、端点吸附、label 和 Undo/Redo。
