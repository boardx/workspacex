# 对象创作与直接编辑

## R1 用例
编辑者以最低操作成本创建 Sticky、Text、Tile、Shape、Image、Drawing，并立即输入或调整。

## R2 前置与触发
用户具有编辑权限；通过双击、一级工具、拖放、快捷键、粘贴或批量输入触发。

## R3 主流程
1. 双击空白或按 `N` 创建 Sticky，焦点直接进入文字；Tab 按附近排列方向以 24px 间距连续创建。
2. Sticky 支持方形/矩形/圆形、颜色、字号、样式、标签、normal/free/auto-height resize；IME composition 不误提交。
3. Text 支持标题/正文/标签层级及直接编辑；Shape 支持矩形、圆、菱形等基础图形和文字。
4. Tile 以图标、标题、描述、状态和可选预览呈现 WorkspaceX 结构化对象。
5. 图片通过上传、拖放、剪贴板和 URL 创建；Drawing 记录可编辑 stroke 数据并投影为 Fabric path。
6. 粘贴多行文本可预览并批量生成 Sticky；Alt/Option 拖动或快捷命令快速复制。

## R4 备选与异常
- A1：附近没有排列趋势时连续 Sticky 默认横向；纵向趋势明确时继续纵向。
- A2：纯文本粘贴可选择保留单对象或按行/列表拆分。
- E1：图片上传失败保留可重试占位，不写入失效 blob 引用。
- E2：超大图片先校验上限和类型，拒绝时给出原因；不冻结画布。
- E3：编辑期间远端删除对象时结束编辑并告知冲突，不能复活 tombstone。
- E4：剪贴板含 HTML/脚本时只读取允许格式并清理危险内容。

## R5 权限
Editor/Owner 可创建编辑；Commenter/Viewer 只能选择阅读；上传还受组织资产策略约束。

## R6 后置与不包含
每个创建动作得到稳定 id、类型化字段和审计 operation；媒体内容写 blob 存储。本轮不包含专业图像滤镜或钢笔贝塞尔编辑器。

## R7 业务规则
- Create first, configure later；默认值必须立即可用。
- 连续创建 500 张 Sticky 仍用一次批量 operation/Yjs transaction，保持确定顺序和位置。
- Copy/paste 使用领域对象格式并提供纯文本兼容，不复制 Fabric 私有状态。

## R8 界面线索
左侧一级工具含 Sticky/Text/Tile/Shape/Draw/Image；选中对象显示 contextual toolbar，复杂属性在右侧 panel。

## R9 非功能约束
输入法、RTL、长文本、触摸键盘与撤销边界可用；图像解码不阻塞主线程长任务。

## R10 依赖
对象 schema/operation、Fabric object registry、资产上传服务、剪贴板 adapter。

## R11 切分
第 2 轮依次交付 Sticky 连续创作、文本/形状、Tile、图片、Drawing、paste intelligence。

## R12 验收线索
- 真实浏览器完成 PRD Brainstorm：60 秒内创建 10 张 Sticky，Tab 连续、可改颜色和移动。
- Ctrl/Cmd+Enter、Tab、IME、500 张批量一次 transaction、复制粘贴和四种图片入口都有可执行断言。
