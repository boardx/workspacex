/**
 * issue #652 — `setConsentDecision`'s use case. Thin on purpose: the judgement (which item
 * names are legal, what "pending" means, the upsert-on-primary-key shape) already lives in
 * the contract and `ConsentMatrixReader.setCell`'s port doc. This function exists so the
 * interface layer calls application code, not a raw store, the same shape every other route
 * in this bundle follows (`startRecording` → `capture.ts`, not straight to `SessionStore`).
 */
import type { ConsentMatrixReader } from "./session-lifecycle-ports";

export interface SetConsentDecisionDeps {
  readonly consent: ConsentMatrixReader;
}

export interface SetConsentDecisionInput {
  readonly sourceRefId: string;
  readonly participantId: string;
  readonly item: string;
  readonly state: "granted" | "denied" | "pending";
}

export interface SetConsentDecisionOutput {
  readonly participantId: string;
  readonly item: string;
  readonly state: "granted" | "denied" | "pending";
  readonly updatedAt: string;
}

export async function setConsentDecision(
  deps: SetConsentDecisionDeps,
  input: SetConsentDecisionInput,
): Promise<SetConsentDecisionOutput> {
  const written = await deps.consent.setCell({
    sourceRefId: input.sourceRefId,
    participantId: input.participantId,
    item: input.item,
    state: input.state,
  });
  return {
    participantId: input.participantId,
    item: input.item,
    state: input.state,
    updatedAt: written.updatedAt,
  };
}
