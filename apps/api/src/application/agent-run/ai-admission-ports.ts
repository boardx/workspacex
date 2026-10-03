import type { OrgId } from "../../domain/org-id";
import type { AiAdmissionDecision } from "../../domain/agent-run/ai-budget";
export interface AiReservationInput {
 readonly requestId: string; readonly userId: string;
 readonly windowStart: string; readonly windowEnd: string;
 readonly maximumTokens: bigint; readonly maximumCostMicros: bigint;
 readonly modelProvider: string; readonly modelId: string;
 readonly currency: string; readonly priceVersion: string;
}
export interface AiAdmissionPort {
 /** replay=true MUST resume the existing request/receipt; never dispatch a new provider call. */
 reserve(orgId: OrgId, input: AiReservationInput): Promise<{
  readonly decision: AiAdmissionDecision; readonly replay: boolean; readonly reservationState?: "held" | "settled";
 }>;
 /** Unknown charges retain the entire hold; only authoritative known settlement releases it. */
 settle(orgId: OrgId, requestId: string, usage: {
  readonly tokens: bigint | null; readonly costMicros: bigint | null;
 }): Promise<void>;
}
