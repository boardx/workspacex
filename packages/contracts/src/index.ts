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
export * as filterAction from "./filter-action";
export * as provenance from "./provenance";
export * as thresholds from "./thresholds";

/* ── phase-01 契约束 ─────────────────────────────────────────────── */
export * as interview from "./interview";
export * as recording from "./recording";
export * as canvas from "./canvas";
export * as chat from "./chat";
export * as agentRuntime from "./agent-runtime";
export * as skills from "./skills";
export * as templates from "./templates";
