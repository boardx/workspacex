/**
 * Phase 18 S8（#4365）—— 记忆运维与记忆整合的真实 API 薄封装（契约 `packages/contracts/src/chat-knowledge-graph.ts`）：
 *
 *   平台（平台运营准入，非运维 403 `NOT_PLATFORM_SUPERUSER`）：
 *     · getPlatformExtractionSlo           GET  /platform/knowledge-graph/extraction-slo
 *     · get/setPlatformConsolidationSetting GET/PUT /platform/knowledge-graph/consolidation-setting
 *     · runPlatformConsolidation           POST /platform/knowledge-graph/consolidation/run（开关关着 409 KG_CONSOLIDATION_DISABLED）
 *   本人：
 *     · listMyConsolidationRuns            GET  /knowledge-graph/me/consolidations
 *     · undoConsolidationRun               POST /knowledge-graph/me/consolidations/:runId/undo
 *
 * 返回值一律经契约 `out` 校验（形状只有契约一份）；类型走 `z.infer`，不重新声明字段名（`lint-contract-source`）。
 * 失败原样抛 `ApiError`（带 reasonCode），由调用方渲染——不吞、不兜底。
 */
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import type { z } from "zod";
import { apiRequest } from "./api-client";

const sloOp = knowledgeGraph.getPlatformExtractionSlo;
const getCslOp = knowledgeGraph.getPlatformConsolidationSetting;
const setCslOp = knowledgeGraph.setPlatformConsolidationSetting;
const runCslOp = knowledgeGraph.runPlatformConsolidation;
const listOp = knowledgeGraph.listMyConsolidationRuns;
const undoOp = knowledgeGraph.undoConsolidationRun;

export type ExtractionSloOut = z.infer<typeof sloOp.out>;
export type ConsolidationSettingOut = z.infer<typeof getCslOp.out>;
export type ConsolidationPassOut = z.infer<typeof runCslOp.out>;
export type ConsolidationRun = z.infer<typeof listOp.out>["runs"][number];

export async function getExtractionSlo(): Promise<ExtractionSloOut> {
  return sloOp.out.parse(await apiRequest<unknown>(sloOp.path, { method: sloOp.method }));
}

export async function getConsolidationSetting(): Promise<ConsolidationSettingOut> {
  return getCslOp.out.parse(await apiRequest<unknown>(getCslOp.path, { method: getCslOp.method }));
}

export async function setConsolidationSetting(enabled: boolean): Promise<ConsolidationSettingOut> {
  return setCslOp.out.parse(await apiRequest<unknown>(setCslOp.path, { method: setCslOp.method, body: { enabled } }));
}

export async function runConsolidationNow(): Promise<ConsolidationPassOut> {
  return runCslOp.out.parse(await apiRequest<unknown>(runCslOp.path, { method: runCslOp.method, body: {} }));
}

export async function listMyConsolidationRuns(signal?: AbortSignal): Promise<readonly ConsolidationRun[]> {
  return listOp.out.parse(await apiRequest<unknown>(listOp.path, { method: listOp.method, signal })).runs;
}

export async function undoConsolidationRun(runId: string): Promise<ConsolidationRun> {
  const path = undoOp.path.replace(":runId", encodeURIComponent(runId));
  return undoOp.out.parse(await apiRequest<unknown>(path, { method: undoOp.method, body: {} })).run;
}
