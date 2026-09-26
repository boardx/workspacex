/**
 * issue #4247 —— 平台级（整个部署）记忆抽取开关的真实 API 薄封装（契约
 * `knowledgeGraph.getPlatformExtractionSetting` / `setPlatformExtractionSetting`，PR #4200）。
 *
 * ⚠ 类型走 `z.infer`，不重新声明字段名（`lint-contract-source` 要求）。
 * ⚠ 两条都要求平台运营准入（`PlatformOperatorGuard`）；非运维收到真实 403
 *   `NOT_PLATFORM_SUPERUSER`，这里不吞、不兜底，交给调用方渲染无权限态。
 */
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import type { z } from "zod";
import { apiRequest } from "./api-client";

const getOp = knowledgeGraph.getPlatformExtractionSetting;
const setOp = knowledgeGraph.setPlatformExtractionSetting;

export type PlatformExtractionSettingOut = z.infer<typeof getOp.out>;
export type PlatformExtractionErrorCode = (typeof getOp.err)[number] | (typeof setOp.err)[number];

export async function getPlatformExtractionSetting(): Promise<PlatformExtractionSettingOut> {
  return apiRequest<PlatformExtractionSettingOut>(getOp.path, { method: getOp.method });
}

export async function setPlatformExtractionSetting(enabled: boolean): Promise<PlatformExtractionSettingOut> {
  return apiRequest<PlatformExtractionSettingOut>(setOp.path, { method: setOp.method, body: { enabled } });
}
