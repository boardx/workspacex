import type { OrgId } from "../../domain/org-id";
import type { AiAdmissionPort } from "./ai-admission-ports";

/** Internal recovery read; implementations must read the existing tenant ledger, never a worker payload. */
export interface AiReceiptRecoverySnapshot {
  readonly orgId: OrgId;
  readonly requestId: string;
  readonly reservationState: "held" | "settled";
  /** Product-price settlement facts from effective_token_usage(), not supplier invoice amounts. */
  readonly receipt: {
    readonly tokens: bigint | null;
    readonly costMicros: bigint | null;
  } | null;
}
export interface AiReceiptRecoveryPort {
  readRecoverySnapshot(orgId: OrgId, requestId: string): Promise<AiReceiptRecoverySnapshot | null>;
}
export type AiReceiptRecoveryResult =
  | { readonly status: "not-found" }
  | { readonly status: "held"; readonly reason: "receipt-missing" | "usage-unknown" }
  | { readonly status: "settled" };

/** Recover terminal-ledger/settlement ACK loss without another supplier call.
 * The existing settle port remains the transaction/ownership authority, including on replay.
 * Missing usage and start-only or ACK-before-intent cases retain conservative holds indefinitely;
 * elapsed time, cancellation, and a supplier request ID cannot establish zero charge.
 */
export async function recoverAiReceiptSettlement(
  deps: { readonly recovery: AiReceiptRecoveryPort; readonly admission: Pick<AiAdmissionPort, "settle"> },
  orgId: OrgId,
  requestId: string,
): Promise<AiReceiptRecoveryResult> {
  const snapshot = await deps.recovery.readRecoverySnapshot(orgId, requestId);
  if (!snapshot) return { status: "not-found" };
  if (snapshot.orgId !== orgId || snapshot.requestId !== requestId
    || !["held", "settled"].includes(snapshot.reservationState)) {
    throw new Error("AI_RECOVERY_SNAPSHOT_SCOPE_MISMATCH");
  }
  if (!snapshot.receipt) {
    if (snapshot.reservationState === "settled") throw new Error("AI_RECOVERY_SETTLED_RECEIPT_MISSING");
    return { status: "held", reason: "receipt-missing" };
  }
  const { tokens, costMicros } = snapshot.receipt;
  for (const value of [tokens, costMicros]) {
    if (value !== null && (typeof value !== "bigint" || value < 0n || value > 9_223_372_036_854_775_807n)) {
      throw new Error("AI_RECOVERY_USAGE_INVALID");
    }
  }
  if (tokens === null || costMicros === null) {
    if (snapshot.reservationState === "settled") throw new Error("AI_RECOVERY_SETTLED_USAGE_UNKNOWN");
    return { status: "held", reason: "usage-unknown" };
  }
  // Always call the existing authoritative port: a snapshot can go stale immediately,
  // and settled receipts must still pass its immutable replay-value comparison.
  await deps.admission.settle(orgId, requestId, { tokens, costMicros });
  return { status: "settled" };
}
