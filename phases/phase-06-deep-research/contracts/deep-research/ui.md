# UI — Deep Research

> 自检：本文件引用 7 张截图，目录下实际 7 张。

深度研究 UI 只收录当前 devapp 实际流程截图。主流程是：研究列表 → 创建研究 → 确认主题 → 研究方向 → 报告大纲 → 资料研究 → 研究报告。

截图目录：`ui-preview/deep-research/`.

## 截图索引

1. [01-research-list-current.png](../../ui-preview/deep-research/01-research-list-current.png) — 研究列表与创建入口
2. [02-create-research-dialog.png](../../ui-preview/deep-research/02-create-research-dialog.png) — 创建研究弹窗
3. [03-confirm-topic-brief.png](../../ui-preview/deep-research/03-confirm-topic-brief.png) — Step 1 确认研究主题与范围
4. [04-research-directions.png](../../ui-preview/deep-research/04-research-directions.png) — Step 2 编辑研究方向
5. [05-report-outline.png](../../ui-preview/deep-research/05-report-outline.png) — Step 3 确认报告大纲
6. [06-web-search.png](../../ui-preview/deep-research/06-web-search.png) — Step 4 资料研究与 Web Search
7. [07-final-report.png](../../ui-preview/deep-research/07-final-report.png) — Step 5 查看研究报告与来源引用

## R6 增量签核材料（待人类确认）

- 预览入口：开发环境 `/research?preview=effort-budget`
- 状态入口：追加 `&state=default|loading|empty|invalid|dep-failed|denied|success`
- 稳定锚点：`research-effort-budget`、`research-effort-fast|std|deep`、`research-budget-save`、`research-budget-summary`
- 待截图：`08-effort-budget-selection.png`、`09-effort-budget-resumed.png`、`10-effort-budget-states.png`
- 核对重点：档位差异是否足够可判断；锁定与恢复语义是否清楚；硬上限是否明确表示为“调用前停止并保留结果”；旧会话未知用量不得伪装成 0。
