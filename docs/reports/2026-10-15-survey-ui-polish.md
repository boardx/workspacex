# 问卷 UI 调优 — #5755

用户已确认只读审查后的优化；主协调纳入四模块统一方案。本轮基于 main `bdd0a2911a05ac03de29b2cd2965ab3623116ee7`，复用3120工作树，保留此前分支。

## 呈现变更

- 弹窗下一步、AI生成、模板新建、开始回收统一采用现有 `WorkflowActionButton` 的 primary；取消/返回采用 outline，动作区复用 `WorkflowActionBar`。不改全站 Button/default、色值、亮度或尺寸规则。
- 创建弹窗仍保留可访问描述，压缩三种创建方式介绍；移除设计与模板页重复教程，发布页只保留必要标题与状态说明。
- 发布前的时间表单改用现有中性 card tokens、右对齐共用动作区；匿名/发布锁定/Cookie限答/时间默认/阻塞提示保持。
- 导入仍为单层 composer、框内工具栏，手机端增加底部留白。工作流步骤条等待主协调统一，本单不另造样式。

## 回归边界

未修改用户题目、字段、请求/API、状态机、权限、ASR/hooks/provider、模型/Skill、样本口径。既有保存/失败/重试/冲突、AI校对与显式应用、语音busy/错误恢复和转写原文保留均保留。

## 验证

改前及最终改后：7文件/124 UI测试通过（survey-ai-proposal、survey-inline-voice、survey-live-library、survey-live-workspace、survey-template-library-live、survey-live-publishing、survey-responsive-designer）。完整web ESLint/token/design lint通过。共用组件接入曾漏import，复验发现并补齐，最终124测试已重跑通过。

TypeScript通过。隔离浏览器首轮AI导入与capture错误2 tests通过；完整流在静态paint断言遇到鼠标hover底色（源码既有hover:bg-muted），已仅移开指针再检查原透明值，独立复验通过（1 test，模板创建→发布→答题→答卷→正式报告）。首轮2通过+末轮1通过共覆盖3条目标流程，未忽略失败、未放宽颜色断言。浏览器实际覆盖：1280/768/375输入与工具栏布局，375×812生成按钮不被移动导航遮挡；AI受控生成/校对/明确应用；语音受控capture错误；模板创建→发布→真实答卷→报告现有流程。受控模型和ASR不等于生产供应商证据。

实际已检视截图：[创建弹窗](assets/issue-5755/survey-create-dialog.png)、[1280](assets/issue-5755/survey-intake-1280.png)、[768](assets/issue-5755/survey-intake-768.png)、[375](assets/issue-5755/survey-intake-375.png)。

[发布设置实际截图](assets/issue-5755/survey-publish-settings.png)、[模板列表](assets/issue-5755/survey-template-library.png)。两轮隔离测试资源均由标准包装器自动清理。

## 人类紧凑反馈增量

2026-10-15 人类明确“更紧凑一些，减少留白”，主协调授权沿同PR最小调整。5758动态读取仍OPEN、未merge；已fetch并安全合入 main `a4346771468f33eb13e25f836c9e74b06f44cba4`，不新建worktree或重复issue。

- 导入页页间距28→16、header20→12、步骤gap12→8，标题28→24；手机底部pb24保留。
- 单层composer内部间距20→12、区块间24→16；默认最小高度手机256→224、桌面288→240，不加最大高度或裁切内容，仍可resize并保留焦点。
- 发布页大屏外边距40→24、卡片内边距24→16、列间距20→16，时间、匿名及限答等原功能保持。
- 共享按钮/footer尺寸与手机primary独行只由 #5760 单源实现，不写模块minwidth。

本增量55受影响UI测试通过。准备单条紧凑呈现浏览器验证（375×812/768/1280输入与发布布局、单层焦点、无溢出、原匿名值、按钮可用且不遮导航），不重复已经通过的完整发布/报告heavy流程。共享纯checkpoint `71b6ced6c02e24daa9b3e808a2cbb19570e868f4` 已cherry为 `b9cebba0f`，只1个既有shared文件，未编辑或复制共享规则；接入后同55 UI与targeted lint再次通过。focused renderer实际通过（1 test，标准隔离队列等待4m25s、执行5m32s、自动清理1s）。已验证375×812主按钮与bar等宽且不遮导航、768/1280主按钮自然宽度、输入单层焦点、无横向溢出、原匿名值与按钮可用性。只在隔离库创建草稿观察发布设置，未开始回收/调用模型或ASR；未重跑完整报告链。

紧凑版实际截图（均已逐张检视）：[输入375](assets/issue-5755/survey-compact-input-375.png)、[输入768](assets/issue-5755/survey-compact-input-768.png)、[输入1280](assets/issue-5755/survey-compact-input-1280.png)、[发布375](assets/issue-5755/survey-compact-publish-375.png)、[发布768](assets/issue-5755/survey-compact-publish-768.png)、[发布1280](assets/issue-5755/survey-compact-publish-1280.png)。
