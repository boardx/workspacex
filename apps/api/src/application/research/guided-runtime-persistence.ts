import { research as C } from "@repo/contracts";
import { GuidedEvidenceLedger } from "./guided-evidence-ledger-record";

/** Internal persisted JSON. Never use this schema for a response. */
export const PersistedResearchRuntimeSchema = C.GuidedResearchRuntime.extend({ privateLedger: GuidedEvidenceLedger.optional() }).strict();

/** Positive selection from the authoritative public contract also excludes future private fields. */
export function toPublicResearchRuntime(state: unknown) {
  const input = state as Record<string, unknown>;
  return C.GuidedResearchRuntime.parse(Object.fromEntries(C.GuidedResearchRuntime.keyof().options.map(key => [key, input[key]])));
}
