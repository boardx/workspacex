import { research as C } from "@repo/contracts";
import { GuidedEvidenceLedger, GUIDED_EVIDENCE_MATCH_LIMIT } from "./guided-evidence-ledger-record";
import { z } from "zod";

export const GUIDED_REPORT_EVIDENCE_CACHE_LIMIT = 512;

/** Internal persisted JSON. Never use this schema for a response. */
export const PersistedResearchRuntimeSchema = C.GuidedResearchRuntime.extend({
  privateLedger: GuidedEvidenceLedger.optional(),
  privateReportEvidenceBatches: z.array(z.object({
    basis: z.string().regex(/^[a-f0-9]{64}$/), evidenceIds: z.array(z.string().min(1)).max(GUIDED_EVIDENCE_MATCH_LIMIT),
  }).strict()).max(GUIDED_REPORT_EVIDENCE_CACHE_LIMIT).optional(),
  // One digest per actual rejected request, like the durable model-call history.
  // Active warnings may be reconciled; these tombstones must never be evicted.
  privateSourceScreenRejectedRequests: z.array(C.GuidedResearchProviderBatchRejection.shape.requestBasis).optional(),
}).strict();

/** Positive selection from the authoritative public contract also excludes future private fields. */
export function toPublicResearchRuntime(state: unknown) {
  const input = state as Record<string, unknown>;
  return C.GuidedResearchRuntime.parse(Object.fromEntries(C.GuidedResearchRuntime.keyof().options.map(key => [key, input[key]])));
}
