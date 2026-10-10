import { research as C } from "@repo/contracts";
import { GuidedEvidenceLedger } from "./guided-evidence-ledger-record";
import { z } from "zod";

/** Internal persisted JSON. Never use this schema for a response. */
export const PersistedResearchRuntimeSchema = C.GuidedResearchRuntime.extend({
  privateLedger: GuidedEvidenceLedger.optional(),
  // One digest per actual rejected request, like the durable model-call history.
  // Active warnings may be reconciled; these tombstones must never be evicted.
  privateSourceScreenRejectedRequests: z.array(C.GuidedResearchProviderBatchRejection.shape.requestBasis).optional(),
}).strict();

/** Positive selection from the authoritative public contract also excludes future private fields. */
export function toPublicResearchRuntime(state: unknown) {
  const input = state as Record<string, unknown>;
  return C.GuidedResearchRuntime.parse(Object.fromEntries(C.GuidedResearchRuntime.keyof().options.map(key => [key, input[key]])));
}
