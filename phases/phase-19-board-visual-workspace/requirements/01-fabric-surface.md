# Fabric 主画布与导航

## R1 用例
编辑者在全屏无限画布中创建、定位和查看内容；查看者可安全导航。主视觉对象必须由 Fabric.js 渲染。

## R2 前置与触发
- 用户具有 Board 读取权限；编辑动作还需写权限。
- 进入 `/studio/board/:boardId`、打开已有 Board 或创建新 Board时触发。

## R3 主流程
1. 页面加载一个 Fabric Canvas，并从 Y.Doc 增量投影对象；DOM 只承载产品壳和无障碍镜像。
2. 用户用鼠标、触控板、触摸或笔执行 Pan、5%–800% Zoom、Fit selection、Fit Board。
3. 用户开关 Grid、Snap、Guidelines、Mini Map；viewport 状态可恢复但不改写对象世界坐标。
4. Fabric 选择/变换事件转为领域 operation；Yjs observer 按 object id 增量 add/patch/remove/reorder，单次 update 不清空 canvas。

## R4 备选与异常
- A1：空 Board 显示可操作的起始提示，不创建假对象。
- A2：Fit Board 在零对象时回到默认 viewport；Fit selection 在无选择时禁用。
- E1：单对象反序列化失败只显示带 id 的错误占位，其他对象仍可编辑。
- E2：Canvas 丢失上下文时自动重建投影并保留 Y.Doc；不得以 Fabric JSON 覆盖 Y.Doc。
- E3：readonly 用户的 Fabric control 全部不可修改，快捷键也不能绕过。

## R5 权限
Viewer 可导航和选择用于阅读；Editor/Owner 可产生 operation；未授权用户看不到 Board 内容。

## R6 后置与不包含
- Object id 在领域模型、Y.Map key、Fabric `data.objectId` 中一致。
- 本规格不定义对象业务属性、连接语义或协作 transport。

## R7 业务规则
- Fabric.js 是 Board 主 renderer；禁止继续以绝对定位 HTML 按钮/SVG 作为对象主表面。
- Fabric JSON 不进入数据库、对象存储、Yjs 或公开 API。
- 每个用户手势对应有界的领域 operation/Yjs transaction，不能靠整板序列化同步。

## R8 界面线索
- 全屏画布；左侧一级工具栏；底部 viewport 控件；Mini Map 可折叠。
- 选择框、控制点、Snap/Guideline 在不同缩放下保持可辨认命中尺寸。

## R9 非功能约束
- 连续 pan/zoom 无全画布重建；渲染与 persistence 解耦。
- ResizeObserver、devicePixelRatio 和 viewport 变化后画布清晰且命中正确。

## R10 依赖
Fabric.js 7.x、whiteboard-core、Yjs 文档 adapter、React Board shell。

## R11 切分
第 1 轮：surface lifecycle、registry/adapter、viewport、selection/navigation、旧 renderer 下线分别交付。

## R12 验收线索
- 真实浏览器断言 Canvas 上 sticky/shape/text 均为 Fabric object，DOM 中没有对应绝对定位交互节点。
- 双浏览器验证 viewport 是用户本地状态、对象世界坐标一致；1000 次 Yjs patch 不触发 `canvas.clear()`。
