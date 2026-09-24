# WorkspaceX Board：便利贴协作白板设计包

状态：Draft / 待产品评审；日期：2026-09-23。本轮交付需求与架构，不代表功能已实现或签核。

产品名使用 Board；代码领域建议使用 `whiteboard`，避免与现有任务看板 `board` 混淆。

## 阅读顺序

1. [需求文档](requirements.md)：替代范围、交互、权限、异常、验收与演进顺序。
2. [系统架构](architecture.md)：Yjs 数据模型、可靠同步、API、AI、会议室和开源边界。
3. [调研依据](research.md)：官方参考与本地实现证据，区分事实和设计建议。
4. [进度](progress.md)与[交接](session-handoff.md)：本轮验证边界与下一步。
5. [9 分产品验收 Backlog](nine-point-backlog.md)：从当前能力到可验证 9/10 的计分、硬门槛、迁移与交付顺序。
6. [内容在线迁移运行手册](content-migration-rollout.md)：组织级 dry-run、限流、暂停/恢复、审计和恢复语义。

这是一次性设计输入，按 `docs/README.md` 归档；尚未创建新 phase 或 feature 清单。进入实施时，将需求迁入选定 phase 的 `requirements/` 并将本目录改为指针，避免双份权威。UI 原型、用例、API 契约仍须按仓库束级签核流程确认。

## 建议评审结论

首版围绕“准备工作坊 → 独立写便签 → 分享与分组 → 画关系 → 投票 → 明确行动 → 导出复用”闭环验收。满足这个闭环及可靠性、权限、迁移门槛后，才称为选定组织场景下的 Miro 替代版本。

将人与人、人与 AI、AI 与 AI 统一到可追溯的白板对象与授权操作；会议室是同一白板的设备入口。首版不依赖模型服务运行。Yjs 为协作底座，渲染器可替换，WorkspaceX 身份、资产、项目与 Agent 能力通过适配层接入。

## 开发进度

用户已要求在 Studio 增加顶级 Board 并分十轮实施。见 [十轮交付计划](implementation-plan.md)、[第一轮界面审阅](ui-review.md)和[浏览器证据](ui-preview/browser-verification.md)。当前交付为第一轮 UI 预览，后端能力未实现。
