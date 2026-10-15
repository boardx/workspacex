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
