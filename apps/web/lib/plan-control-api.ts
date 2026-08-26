/**
 * F977 —— UC-1 `getPlanLedger` 的前端取数口。真实 `GET /plan-control/threads/:id/ledger`
 * （F977 新接的 HTTP 面，`apps/api/src/interface/controllers/plan-control.controller.ts`），
 * 不是 mock 数据。返回值经 `planControl.getPlanLedger.out` 校验——契约单一事实源，
 * 不在这里另猜一份形状。
 */
import { apiRequest } from "@/lib/api-client";
import { planControl } from "@repo/contracts/plan-control";
import type { z } from "zod";

export type PlanLedgerView = z.infer<typeof planControl.getPlanLedger.out>;

export async function fetchPlanLedger(threadId: string): Promise<PlanLedgerView> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/ledger`);
  return planControl.getPlanLedger.out.parse(raw);
}
