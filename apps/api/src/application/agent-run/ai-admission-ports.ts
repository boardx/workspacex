import type { OrgId } from "../../domain/org-id";
import type { AiAdmissionDecision } from "../../domain/agent-run/ai-budget";
import type {z} from "zod";
import type {Configuration} from "@repo/contracts/ai-policy";
export interface AiConfiguredBudget {readonly decision:"configured";readonly plan:"ordinary"|"enterprise";
 readonly configuration:z.infer<typeof Configuration>;readonly priceVersion:string;}
export interface AiBudgetPolicyPort {
 /** Derives a member window from the audited org template; never resets an existing window. */
 resolveBudgetPolicy(orgId:OrgId,userId:string):Promise<AiConfiguredBudget|{readonly decision:AiAdmissionDecision|"AI_POLICY_UNCONFIGURED"|"AI_SUBJECT_NOT_MEMBER"}>;
}
export interface AiReservationInput {
 readonly requestId: string; readonly userId: string;
 readonly formalModelId?:string;readonly agentId?:string|null;
 /** Original trusted classification and formal model IDs, verified against immutable policy. */
 readonly tokenPolicy?:{readonly primaryModelId:string;readonly selectedModelId:string;readonly allowDegradation:boolean};
 /** Trusted stable logical call + bounded real attempt slot; all three present together. */
 readonly logicalCallId?:string;readonly logicalAttempt?:number;readonly maximumAttempts?:number;
 readonly windowStart: string; readonly windowEnd: string;
 readonly maximumTokens: bigint; readonly maximumCostMicros: bigint;
 readonly modelProvider: string; readonly modelId: string;
 readonly currency: string; readonly priceVersion: string;
}
export interface AiAdmissionPort {
 /** replay=true MUST resume the existing request/receipt; never dispatch a new provider call. */
 reserve(orgId: OrgId, input: AiReservationInput): Promise<{
  readonly decision: AiAdmissionDecision; readonly replay: boolean; readonly reservationState?: "held" | "settled"; readonly tokenWarning?:boolean;readonly degradeToModelId?:string;
 }>;
 /** Unknown charges retain the entire hold; only authoritative known settlement releases it. */
 settle(orgId: OrgId, requestId: string, usage: {
  readonly tokens: bigint | null; readonly costMicros: bigint | null;
 }): Promise<void>;
}

export interface AiReservedPrice {
 readonly userId:string;readonly modelProvider:string;readonly modelId:string;
 readonly currency:string;readonly priceVersion:string;
 readonly price:z.infer<typeof Configuration>["prices"][number];
}
export interface AiReservedPricePort {
 /** Immutable reservation + audited policy version, independent of worker/current policy/lease. */
 readReservedPrice(orgId:OrgId,requestId:string):Promise<AiReservedPrice|null>;
}
