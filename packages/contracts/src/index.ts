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
