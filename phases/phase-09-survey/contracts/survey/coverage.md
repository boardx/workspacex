# Coverage — Survey (2026-09-28 prototype revision, pending signoff)

本表追踪新原型 UC → 现有 API／契约 → 前端消费点；它不是 `feature_list.json` 的状态副本。旧 F01–F07 的范围和 verification 尚待重切，不能据此宣称 passing。API 形状仍以 `packages/contracts/src/survey*.ts` 的 Zod schema 为唯一事实源。

| 用例 | API／契约操作 | 前端消费点 | 待验证边界 |
| --- | --- | --- | --- |
| UC1 浏览与创建 | `GET /surveys`、`POST /surveys`、`GET /surveys/templates?kind=question`、`SurveyDraftInputSchema` | `/studio/survey`、创建弹窗、`/:id/design` | 名称默认值、可选标签、模板深复制、项目挂载。 |
| UC2 AI 导入与校对 | `POST /surveys/markdown-proposals`、`SurveyMarkdownProposalInputSchema`、`SurveyMarkdownProposalSchema`；确认后使用 `POST /surveys`／`PUT /surveys/:id/source` | `/studio/survey/new/import` | 未确认不持久化提案为问卷；文件／录音授权、解析失败、刷新恢复。 |
| UC3 设计与保存 | `GET /surveys/:id`、`PUT /surveys/:id`、`PUT /surveys/:id/source`、`SurveySourceSaveCommandSchema` | `/:id/design` | Markdown 单源、版本冲突、自动保存与未保存离开。 |
| UC4 发布与回收 | `POST /surveys/:id/prepare`、`/publish`、`/start-collection`、`/close`；公开填写沿用 `/public/surveys` 控制器 | `/:id/publish`、公开问卷页 | 发布快照、截止、匿名／同浏览器限答、成功页 Markdown、真实统计。 |
| UC5 查看答卷 | `GET /surveys/:id`、`PATCH /surveys/:id/responses/:responseId`、现有导出投影 | `/:id/responses`、`/:id/responses/:responseId` | 匿名边界、有效性处理、零答卷、导出失败。 |
| UC6 可选模板／报告 | `GET/POST/PUT /surveys/templates`、`POST /surveys/:id/report`、`SurveyReportTemplateSchema` | 问卷／报告模板入口、`/:id/report` | 不阻塞主流程；报告读取对应版本有效答卷。 |

## 反向检查与未关闭项

- 旧五步 `template`／`report` schema 值和 `?step=` 链接需兼容，但不再作为主进度节点。
- 现场快速投票、催填名单、`responses.csv + schema.json` 属旧阶段范围；本轮不删除已有能力，也不把它们混入新原型 UI PR。是否另立功能由后续阶段规划决定。
- 公开填写、一次一浏览器的服务端行为和报告来源需用真实 API／数据库测试复核；本表只确认已有接口落点，不等于动态通过。
