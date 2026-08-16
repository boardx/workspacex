# Guided Research LangGraph · UI 增量

本增量沿用已签六屏视觉材料，只改变工作流承载方式和信息布局，不新增第二套页面。

## 单页结构

- canonical URL：`/research?session=<sessionId>`；旧 `flow=` 只兼容一次并收敛到 canonical URL。
- 左列约三分之一：持久化的研究 Skill 对话、当前节点建议、显式应用/撤销。
- 右列约三分之二：五步进度、当前节点编辑器和主操作；报告正文使用右列完整宽度。
- 节点切换使用 React 状态与 workflow projection，不导航、不整页刷新、不自动调用模型。

## 可见状态

进度条区分 completed/current/locked/stale/failed。未来节点禁用；已完成节点可回看；上游重确认后，下游
立即显示 stale，并在再次生成前不得冒充当前结果。刷新后所有状态与输入来自 workflow GET。

## 关键锚点

- `research-skill-assistant`
- `research-step-main`
- `research-workflow-progress`
- `research-node-error`
- `research-confirm-brief` / `research-confirm-directions` / `research-confirm-outline`
- `research-start-search` / `research-complete-report`
- `research-report`
