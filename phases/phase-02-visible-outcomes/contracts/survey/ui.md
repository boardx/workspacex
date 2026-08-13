# Survey 五步工作流 UI 材料

> 本文件引用 6 张截图，目录下实际 6 张。

## 路由

- 列表入口：`/studio/survey`，转入默认问卷的设计步骤。
- 唯一工作流入口：`/studio/survey/[surveyId]?step=design|template|publish|responses|report`。
- 状态预览：`state=loading|empty|error`；只读预览：`readonly=1`。

## 关键组件与锚点

- `SurveyWorkflowShell`：`survey-workflow-shell`、`survey-workflow-steps`。
- 设计：`survey-design-question-list`、`survey-design-question-editor`、`survey-design-ai-assistant`。
- 模板：`survey-template-section-list`、`survey-template-editor`、`survey-template-preview`。
- 发布：`survey-publish-checks`、`survey-publish-link`、`survey-publish-quality-summary`。
- 答题：`survey-response-table`、`survey-response-detail`。
- 报告：`survey-report-toc`、`survey-report-content`。
- 状态：`survey-workflow-loading`、`survey-workflow-empty`、`survey-workflow-error`、`survey-workflow-readonly`、`survey-workflow-saved`。

## 截图

1. [设计问卷](../../ui-preview/survey-v2/01-design.png)
2. [报告模板](../../ui-preview/survey-v2/02-template.png)
3. [发布回收](../../ui-preview/survey-v2/03-publish.png)
4. [查看答题](../../ui-preview/survey-v2/04-responses.png)
5. [分析报告](../../ui-preview/survey-v2/05-report.png)
6. [移动端设计首屏](../../ui-preview/survey-v2/06-mobile-design.png)

## 人类签核重点

- 五张新参考图是否已被正确收敛为同一套五步流程。
- 旧四标签是否应完全退出一级导航。
- 桌面端三栏密度、移动端单列重排是否符合预期。
- 现场快速投票继续作为独立后续 feature，而非五步之一。
