# Survey UI 覆盖矩阵

| UC / 验收线索 | 契约操作 | 前端消费点 | 当前状态 |
| --- | --- | --- | --- |
| UC-12.1 题目编辑与章节映射 | `EditQuestion` | `survey-design-question-editor` | UI mock 已覆盖 |
| UC-12.1 报告模板章节 | `EditQuestion` + 模板章节模型 | `survey-template-editor` / `survey-template-preview` | UI mock 已覆盖 |
| UC-12.2 发布必须一次返回全部阻断 | `ValidateForPublish` | `survey-publish-checks` | UI mock 已覆盖 |
| UC-12.2 回收进度与质量 | 派生指标选择器 | `survey-publish-quality-summary` | UI mock 已覆盖 |
| UC-12.3 答卷筛选与匿名边界 | `FilterAndReviewResponses` | `survey-response-table` / `survey-response-detail` | UI mock 已覆盖 |
| UC-12.3 报告可追溯到模板章节 | `RegenerateReport` | `survey-report-toc` / `survey-report-content` | UI mock 已覆盖 |
| UC-12.4 现场快速投票 | 独立后续契约 | 不在五步 UI | 明确不覆盖 |

反向检查：本轮 UI 没有声明任何真实 HTTP 操作；所有本地动作均能指向上表的原型端口或纯派生选择器。
