/**
 * @repo/contracts — API 契约的**唯一事实源**（ADR-020）
 *
 * 每个契约束一个模块。前后端、mock、OpenAPI 全部从这里派生，
 * **任何一样都不许手写第二份**——本项目已五次因「同一事实声明在两处」而漂移。
 */
export * as identity from "./identity";
export * as auth from "./auth";
export * as artifact from "./artifact";
export * as project from "./project";
export * as files from "./files";
export * as orgAdmin from "./org-admin";
export * as assetGovernance from "./asset-governance";
export * as contextPack from "./context-pack";
export * as omissionReason from "./omission-reason";
export * as consentItem from "./consent-item";
export * as filterAction from "./filter-action";
export * as provenance from "./provenance";
export * as thresholds from "./thresholds";
export * as agentDefaults from "./agent-defaults";

/* ── phase-01 契约束 ─────────────────────────────────────────────── */
export * as interview from "./interview";
export * as recording from "./recording";
export * as canvas from "./canvas";
export * as chat from "./chat";
export * as chatFileUpload from "./chat-file-upload";
export * as agentRuntime from "./agent-runtime";
export * as standardCapabilities from "./standard-capabilities";
export * as agentPrivateChat from "./agent-private-chat";
export * as skills from "./skills";
export * as wave2Runtime from "./wave2-runtime";
export * as templates from "./templates";
export * as research from "./research";
export * as survey from "./survey";
export * as personalRealtimeTranscription from "./personal-realtime-transcription";

/* ── phase-03 契约束 ───────────────────────────────────────────────── */
export * as feedbackLoop from "./feedback-loop";

/* ── phase-10 契约束 ───────────────────────────────────────────────── */
// viewer-role 束的真实实现（F02，有真实 controller）：viewer-role.ts。
// live-collab-viewer-role.ts 是 #1721 先行落地的草案文件，本轮起降级为「仅供
// live-collab-module-routing/stage-aggregation 复用 VIEWER_SCOPE_DENIED 常量的
// 内部工具文件」，不再是 viewer-role 束的契约来源（third-artifact-map.json 同步）。
export * as viewerRole from "./viewer-role";
export * as liveCollabViewerRole from "./live-collab-viewer-role";
export * as liveCollabCheckin from "./live-collab-checkin";
export * as liveCollabModuleRouting from "./live-collab-module-routing";
export * as liveCollabSegmentEngine from "./live-collab-segment-engine";
export * as liveCollabStageAggregation from "./live-collab-stage-aggregation";

/* ── UX-9 冲刺（AG-UI 桥扩展轴）──────────────────────────────────── */
export * as aguiStateEvents from "./agui-state-events";
export * as deepAgentHitl from "./deep-agent-hitl";
export * as agentInterrupts from "./agent-interrupts";
/* ── issue #3367：AG-UI `RUN_ERROR` 的三类处置（出口类型门的单一事实源）──── */
export * as aguiRunError from "./agui-run-error";

/* ── TW-P0-3 计划编辑与执行控制（F972）─────────────────────────────── */
export * as planControl from "./plan-control";

/* ── phase-02 看板（F01）任务对象统一五态 ─────────────────────────────── */
export * as board from "./board";

/* ── 系统异常自动捕获（平台超管只读 + 前端上报） ─────────────────────── */
export * as systemErrorLogs from "./system-error-logs";
export * as systemDebugTrace from "./system-debug-trace";

/* ── 异步子任务派发（issue #2664）+ 后台任务面板（issue #2666）────────── */
export * as subtaskRun from "./subtask-run";

/* ── UC-17.8 Sprint 2 · 统一收件箱（反馈 + 系统异常 [+ B4 设计方案] 的只读投影，D2 替换旧三 tab）── */
export * as inbox from "./inbox";

/* ── UC-17.8 Sprint 3 · PM 设计工作台（Project 实体 + 推送到收件箱 + 双向关联地基）───────── */
export * as designWorkbench from "./design-workbench";

/* ── UC-17.8 Sprint 4 · AI 协作（B5：两束共用的「模型/退路」词汇，不新增路由）───────────── */
export * as designAiCollab from "./design-ai-collab";
export * as designPrototype from "./design-prototype";

/* ── 两级成员管理：平台级名册与角色调整（组织级在 org-admin 束）────────── */
export * as platformMembers from "./platform-members";

/* ── 运营状态屏：服务中断时长与可用性可视化（issue #2645）───────────────── */
export * as systemUptime from "./system-uptime";

/* ── phase-14 契约束（agent-kernel-unification，五束，2026-09-04 建，
 *   design-signoff.md 全部 status: pending，待人类签核）───────────────── */
export * as kernelGateway from "./kernel-gateway";
export * as streamingTransport from "./streaming-transport";
export * as planPermissions from "./plan-permissions";
export * as artifactsSteering from "./artifacts-steering";
export * as errorObservability from "./error-observability";
export * as sandboxSession from "./sandbox-session";
export * as standardBrowserTools from "./standard-browser-tools";

/** Live atomic Skill package editing, user-approved five-hour test release (#3249). */
export * as skillFileEdit from "./skill-file-edit";

/** `/agent/team4` 投后管理报告 Agent（ad-hoc 临时 Agent）的判据阈值、派生公式与自检
 *  算例的单一事实源；方法论正文与后端参照实现都从这里派生。见
 *  `docs/agents/team4-post-investment-report-mvp.md`。不进任何 phase feature_list。 */

/* ── phase-16 契约束（postinvest-rating-agent，2026-09-15 建，
 *   design-signoff.md status: pending，待人类签核）──────────────────────── */
export * as postinvestRating from "./postinvest-rating";
/* 评分规则手册（S1/S2/S3 档位表 / 权重 / 分级带 / 降级触发）的单一事实源：
 * 后端 `scoring.ts` 与前端任务书都从这里读，避免"改了实现忘了改提示词"（ADR-020）。
 * R7-1 的最终归宿是 F01 的 skill 包，包建起来后本文件搬家、不再抄第二份。 */
export * as postinvestRatingRules from "./postinvest-rating-rules";

export * as whiteboard from './whiteboard';
export * as whiteboardImport from './whiteboard-import';
export * as whiteboardDocument from './whiteboard-document';
export * as whiteboardPublic from './whiteboard-public';
export * as whiteboardSync from './whiteboard-sync';
