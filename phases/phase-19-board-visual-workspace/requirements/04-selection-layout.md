# 选择、对齐与视觉布局

> 元数据：估点 **18**（与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。

## R1 用例
编辑者选择多个对象并快速对齐、分布、排序、形成网格/行列或智能结构。

## R2 前置与触发
Board 有可选对象；单击、Shift 点击、框选、Select all 或对象大纲选择触发。

## R3 主流程
1. 单选、多选和框选在 Fabric 上显示统一选择边界，并同步 contextual toolbar。
2. 多选支持 Align left/center/right/top/middle/bottom、水平/垂直 distribute、统一尺寸。
3. Grid、Row、Column 按确定性规则排布，保留稳定 ids、文字和连接关系。
4. Smart Layout 根据当前空间关系给出预览；确认后以一个批量 operation 应用，取消不修改 Y.Doc。
5. Snap 与 Guidelines 展示对齐线、相等间距和容器边界；按修饰键可暂时关闭。

## R4 备选与异常
- A1：混合锁定与可编辑对象时，工具栏明确跳过锁定对象并预览实际影响范围。
- A2：不同大小对象分布按外边界计算；用户可选择中心点模式。
- E1：少于所需对象数时对应命令禁用并说明原因。
- E2：远端在预览期间删除/移动对象时，确认前重新校验 revision；冲突则刷新预览。
- E3：布局结果越过数值/画布边界时拒绝并恢复原状态。

## R5 权限
只有可编辑且未锁定对象参与 mutation；Viewer 可多选阅读但看不到可执行编辑命令。

## R6 后置与不包含
布局产出领域 geometry operation；不持久化 Fabric ActiveSelection/Group。本轮不含自动生成复杂信息架构。

## R7 业务规则
- 同一输入、参数和版本必须产生相同布局。
- 连接线、评论锚点、Panel membership 和 object id 在布局后保持有效。
- 一次布局是一次可撤销/重做的历史动作。

## R8 界面线索
多选浮动工具条只显示当前可用命令；预览与确认/取消清晰；快捷键可触发常用对齐。

## R9 非功能约束
500 对象批量布局不产生 500 次网络往返或 500 个 undo entry；预览保持响应。

## R10 依赖
几何内核、批量 operation、Connector recompute、Fabric selection adapter。

## R11 切分
第 4 轮：selection model、align/distribute、grid/row/column、smart preview、snap/guidelines。

## R12 验收线索
PRD Organize 旅程在 30 秒内完成框选、对齐、分布、成组；双浏览器结果 geometry/hash 一致，Undo 一步还原。
