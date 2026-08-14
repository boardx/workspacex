/**
 * `provenance` 束的真实 API 薄封装（#1182）。
 *
 * `GET /provenance` 是**唯一的**审计检索面（契约注释逐字，一致性复核 X-2）——
 * identity 与 artifact 两束都往 `provenance_events` 写，读端只有这一个。
 * 所以这个文件也只有一个函数，且不该长出第二个「快捷查询」。
 *
 * ⚠ 契约的 `in` 还有 `types` / `actorId` / `targetKind` / `since` / `until` / `cursor`，
 *   这里**只封装当前有调用方的那两个参数**。原因不是偷懒：`apiRequest` 的 `query`
 *   今天只接受 `Record<string, string | undefined>`，`types` 是数组，封装它就得先
 *   动 `api-client` 的通用签名。为一个还没有调用方的参数去改所有请求都走的那层，
 *   是拿真实风险换一个假设的方便。需要按类型筛时再一起改，那时有真实的形状可对。
 *
 * 类型全部 `z.infer`，不手写 interface（`lint-contract-source` 要求，
 * 手写的那一刻就多了一份会漂移的副本）。
 */
import { provenance } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProvenanceEventType = z.infer<typeof provenance.ProvenanceEventType>;
export type ProvenanceEvent = z.infer<typeof provenance.ProvenanceEvent>;
export type QueryProvenanceOut = z.infer<typeof provenance.operations.queryProvenance.out>;

export async function queryProvenance(orgId: string, limit: number): Promise<QueryProvenanceOut> {
  return apiRequest<QueryProvenanceOut>(provenance.operations.queryProvenance.path, {
    method: "GET",
    query: { orgId, limit: String(limit) },
  });
}
