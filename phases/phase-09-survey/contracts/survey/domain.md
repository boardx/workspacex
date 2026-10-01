# Domain — Survey

- SurveyStatus: `draft | ready | collecting | closed`
- 用户主流程：`design → publish → responses`；`import` 仅 AI 创建前置，模板与报告为可选入口，不作为主流程步骤。现有 `SurveyWorkflowStepSchema` 包含遗留取值，兼容策略由路由迁移单独验证，不能直接删除已在用的契约值。
- SurveyQuestionType: `single | multi | scale | open`
- SurveyChartType: `gap-matrix | capability-table | grouped-bar | line | radar`
- Canonical source：问卷设计、发布配置、报告模板使用现有 Markdown source documents；发布及成功页快照一经发布不随草稿后改而变化。
- Response／report：保留现有答卷存储、Markdown 投影和导出；报告只读取对应发布版本的有效答卷。
