# Survey 五步 UI 用例端口

## EditQuestion

- in：`surveyId/questionId/title/type/chapterId/required/options`。
- out：更新后的 `Question` 与保存反馈。
- pre：问卷处于可编辑状态且调用者可写。
- err：`SURVEY_READONLY | QUESTION_NOT_FOUND | QUESTION_INVALID`。

## ValidateForPublish

- in：完整 `SurveyWorkflowModel`。
- out：一次返回全部发布阻断；空数组表示通过。
- pre：问卷和报告模板可读取。
- err：`QUESTION_OPTIONS_EMPTY | MAPPING_INCOMPLETE`。

## FilterAndReviewResponses

- in：搜索词、职级、组织规模、质量状态、分页与答卷 ID。
- out：筛选页、全量指标、所选答卷详情与更新后的质量状态。
- pre：匿名问卷不得返回可反查个人身份的字段。
- err：`RESPONSE_NOT_FOUND | ANONYMOUS_IDENTITY_FORBIDDEN | SURVEY_READONLY`。

## RegenerateReport

- in：`surveyId` 与当前模板章节身份集合。
- out：新报告，或保留旧报告的失败状态。
- pre：至少存在一份有效答卷和一个模板章节。
- err：`NO_VALID_RESPONSES | TEMPLATE_EMPTY | GENERATION_FAILED`。

本轮 UI 原型仅在客户端模拟这些端口的可见结果；不声明真实 HTTP 路由。
