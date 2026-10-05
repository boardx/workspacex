import { describe, expect, it, vi } from "vitest";
import type { OrgId } from "../../src/domain/org-id";
import { recoverAiReceiptSettlement, type AiReceiptRecoverySnapshot } from "../../src/application/agent-run/stage-two-receipt-recovery";
const orgId = "org-a" as OrgId;
const requestId = "physical-request";
const base: AiReceiptRecoverySnapshot = { orgId, requestId, reservationState: "held", receipt: { tokens: 3n, costMicros: 7n } };
function fixture(snapshot: AiReceiptRecoverySnapshot | null = base) {
  const settle = vi.fn(async () => {});
  const readRecoverySnapshot = vi.fn(async () => snapshot);
  return { settle, readRecoverySnapshot, deps: { recovery: { readRecoverySnapshot }, admission: { settle } } };
}
describe("durable receipt settlement recovery", () => {
  it("settles an existing physical receipt without a provider or pricing dependency", async () => {
    const f = fixture();
    expect(await recoverAiReceiptSettlement(f.deps, orgId, requestId)).toEqual({ status: "settled" });
    expect(f.readRecoverySnapshot).toHaveBeenCalledWith(orgId, requestId);
    expect(f.settle).toHaveBeenCalledTimes(1);
    expect(f.settle).toHaveBeenCalledWith(orgId, requestId, { tokens: 3n, costMicros: 7n });
  });
  it("replays settled ACK loss through the authoritative transaction", async () => {
    const f = fixture({ ...base, reservationState: "settled" });
    await recoverAiReceiptSettlement(f.deps, orgId, requestId);
    await recoverAiReceiptSettlement(f.deps, orgId, requestId);
    expect(f.settle).toHaveBeenCalledTimes(2);
  });
  it("never treats a missing reservation as a fresh provider request", async () => {
    const f = fixture(null);
    expect(await recoverAiReceiptSettlement(f.deps, orgId, requestId)).toEqual({ status: "not-found" });
    expect(f.settle).not.toHaveBeenCalled();
  });
  it("retains a start-only hold with no terminal receipt", async () => {
    const f = fixture({ ...base, receipt: null });
    expect(await recoverAiReceiptSettlement(f.deps, orgId, requestId)).toEqual({ status: "held", reason: "receipt-missing" });
    expect(f.settle).not.toHaveBeenCalled();
  });
  it.each([{ tokens: null, costMicros: 7n }, { tokens: 3n, costMicros: null }, { tokens: null, costMicros: null }])("does not release partial/unknown usage %s", async receipt => {
    const f = fixture({ ...base, receipt });
    expect(await recoverAiReceiptSettlement(f.deps, orgId, requestId)).toEqual({ status: "held", reason: "usage-unknown" });
    expect(f.settle).not.toHaveBeenCalled();
  });
  it.each([null, { tokens: null, costMicros: 7n }])("rejects a settled snapshot with missing known receipt %s", async receipt => {
    const f = fixture({ ...base, reservationState: "settled", receipt });
    await expect(recoverAiReceiptSettlement(f.deps, orgId, requestId)).rejects.toThrow("AI_RECOVERY_SETTLED_");
    expect(f.settle).not.toHaveBeenCalled();
  });
  it("allows reported zero only by asking the existing receipt-verifying settlement", async () => {
    const f = fixture({ ...base, receipt: { tokens: 0n, costMicros: 0n } });
    await recoverAiReceiptSettlement(f.deps, orgId, requestId);
    expect(f.settle).toHaveBeenCalledWith(orgId, requestId, { tokens: 0n, costMicros: 0n });
  });
  it.each([{ orgId: "org-b" as OrgId }, { requestId: "other-request" }, { reservationState: "released" as never }])("rejects cross-scope or forged snapshot %s", async changes => {
    const f = fixture({ ...base, ...changes });
    await expect(recoverAiReceiptSettlement(f.deps, orgId, requestId)).rejects.toThrow("AI_RECOVERY_SNAPSHOT_SCOPE_MISMATCH");
    expect(f.settle).not.toHaveBeenCalled();
  });
  it.each([-1n, 9_223_372_036_854_775_808n, 1 as never])("rejects invalid product-ledger values %s", async tokens => {
    const f = fixture({ ...base, receipt: { tokens, costMicros: 7n } });
    await expect(recoverAiReceiptSettlement(f.deps, orgId, requestId)).rejects.toThrow("AI_RECOVERY_USAGE_INVALID");
    expect(f.settle).not.toHaveBeenCalled();
  });
  it("surfaces stale/conflicting receipt errors without fallback release or model retry", async () => {
    const f = fixture();
    f.settle.mockRejectedValueOnce(new Error("AI_SETTLEMENT_REPLAY_MISMATCH"));
    await expect(recoverAiReceiptSettlement(f.deps, orgId, requestId)).rejects.toThrow("AI_SETTLEMENT_REPLAY_MISMATCH");
    expect(f.settle).toHaveBeenCalledTimes(1);
  });
});
