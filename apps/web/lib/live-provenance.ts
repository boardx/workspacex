/**
 * `provenance` 束的真实 API 薄封装（#1182）。
 *
 * `GET /provenance` 是**唯一的**审计检索面（契约注释逐字，一致性复核 X-2）——
 * identity 与 artifact 两束都往 `provenance_events` 写，读端只有这一个。
 * 所以这个文件也只有一个函数，且不该长出第二个「快捷查询」。
 *
 * ⚠ 契约的 `in` 还有 `types` / `actorId` / `since` / `until` / `cursor`，
 *   这里**只封装当前有调用方的那几个参数**。原因不是偷懒：`apiRequest` 的 `query`
 *   今天只接受 `Record<string, string | undefined>`，`types` 是数组，封装它就得先
 *   动 `api-client` 的通用签名。为一个还没有调用方的参数去改所有请求都走的那层，
 *   是拿真实风险换一个假设的方便。需要按类型筛时再一起改，那时有真实的形状可对。
 *
 * ⚠ F964（2026-08-20）：加了 `targetKind`/`targetId` 两个可选参数——项目「成果沉淀 ·
 *   审计与反馈」区（`tab-results.tsx`）需要把检索范围收窄到「这一个项目」，不是整个
 *   组织。契约的 `in` 早就有这两个字段（`ProvenanceTargetKind` 闭枚举含 `"project"`），
 *   只是此前没有调用方去传——同一条纪律：加还没人用的参数是拿真实风险换假设的方便，
 *   现在有真实调用方了，补上就是补参数，不是发明新字段。第三参数用可选 options 对象
 *   而不是再加两个位置参数，是为了不破坏 `queryProvenance(orgId, limit)` 这个既有调用点。
 *
 * 类型全部 `z.infer`，不手写 interface（`lint-contract-source` 要求，
 * 手写的那一刻就多了一份会漂移的副本）。
 */
import { provenance } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProvenanceEventType = z.infer<typeof provenance.ProvenanceEventType>;
export type ProvenanceEvent = z.infer<typeof provenance.ProvenanceEvent>;
export type ProvenanceTargetKind = z.infer<typeof provenance.ProvenanceTargetKind>;
export type QueryProvenanceOut = z.infer<typeof provenance.operations.queryProvenance.out>;

export interface QueryProvenanceOptions {
  targetKind?: ProvenanceTargetKind;
  targetId?: string;
}

export async function queryProvenance(
  orgId: string,
  limit: number,
  opts: QueryProvenanceOptions = {},
): Promise<QueryProvenanceOut> {
  return apiRequest<QueryProvenanceOut>(provenance.operations.queryProvenance.path, {
    method: "GET",
    query: {
      orgId,
      limit: String(limit),
      ...(opts.targetKind ? { targetKind: opts.targetKind } : {}),
      ...(opts.targetId ? { targetId: opts.targetId } : {}),
    },
  });
}
