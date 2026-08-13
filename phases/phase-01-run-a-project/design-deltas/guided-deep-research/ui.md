# 引导式 Deep Research · UI 签核材料

默认路由：`/research`（首页）；后续步骤：`/research?flow=<step>`。既有 Research Studio
屏保留为 `/research?screen=list|plan|new|detail|live`。实现落点：

- `apps/web/components/research-studio/guided-research-flow.tsx`
- `apps/web/lib/mock/guided-research.ts`
- `apps/web/components/research-studio/research-studio-app.tsx`

本轮严格 UI-first：真实组件 + mock 状态，不接 API、不写 DB。

## 六屏索引

| Step | 用户行为 | 关键锚点 | 截图 |
|---|---|---|---|
| 首页 | 历史研究、创建、继续、查看 | `research-history` / `research-create` | [01-home.png](./ui-preview/01-home.png) |
| 主题确认 | 编辑主题和范围 | `research-brief-topic` / `research-confirm-brief` | [02-brief.png](./ui-preview/02-brief.png) |
| 研究方向 | 编辑、新增、删除、启停方向 | `research-directions` / `research-direction-title-<id>` | [03-directions.png](./ui-preview/03-directions.png) |
| 报告大纲 | 编辑/新增章节，确认后搜索 | `research-outline` / `research-start-search` | [04-outline.png](./ui-preview/04-outline.png) |
| Web Search | 当前查询、章节进度、来源 | `research-search-progress` / `research-source-<id>` | [05-search.png](./ui-preview/05-search.png) |
| 完整报告 | 正文、目录、来源引用 | `research-report` / `research-citation-<id>` | [06-report.png](./ui-preview/06-report.png) |

## 交互性质

- `继续研究` 根据该历史项的 `resumeAt` 导向主题或搜索；`查看研究` 导向报告。
- brief 使用受控输入；主题或目标为空时提交禁用。
- directions 与 outline 都使用受控数组，测试直接修改值并断言 DOM 更新。
- 搜索态不是无限 spinner：同时公开整体百分比、当前查询、任务状态、来源数和最新来源。
- 报告引用逐条具有稳定 citation id，为后续跳转到原始网页/快照保留接口。

## 待签核边界

- UI 中的「导出报告」只表达最终报告的动作位置，导出格式不在本 delta。
- UI 中的「重新生成」必须在真实实现时保留当前版本并二次确认，具体版本契约需在实现 feature 细化。
- 这六屏不替代既有 Research Studio 列表、计划、详情和现场研究，它们是同一模块的新引导入口。
