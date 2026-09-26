# Phase 19 Board Visual Workspace requirements

这些文件把用户提供的《Board 基础画布与视觉编辑体验 PRD V0.1》保留为可追溯原文，并拆成可由 `feature_list.json` 引用的稳定 R 条目。

建议阅读顺序：

1. `00-source-prd.md`：清除无效 `chatgpt-content-reference` 标记后的原始需求；需求含义未改。
2. `00-overview.md`：目标、硬架构边界、十轮顺序和 9/10 判定门槛。
3. `01-fabric-surface.md`：Fabric.js 主表面、viewport 和增量投影。
4. `02-object-authoring.md`：Sticky/Text/Tile/Shape/Image/Draw 与连续创作。
5. `03-structure-connectors.md`：Panel/Group/Layer/Lock/Connector。
6. `04-selection-layout.md`：多选、对齐、分布与智能布局。
7. `05-collaboration-history.md`：Yjs 协作、评论、Undo/Redo、离线、会议室和恢复。
8. `06-ai-chat-handoff.md`：AI operation 与 Chat 实际 Fabric 布局交接。
9. `07-interchange-storage.md`：Miro/Mural、开放 API、PG 元数据和文件/blob 内容存储。
10. `08-performance-accessibility.md`：10k 性能、无障碍、长时 soak 与九分收口。

`requirements/` 是输入与追溯材料；阶段权威仍是 `../feature_list.json`。本目录不代表设计已签核，也不能替代契约束中的 `design-signoff.md`。
