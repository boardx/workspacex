import { AidtStoredContextSnapshot, AidtContextErrorCode, AIDT_CONTEXT_LIMITS, aidtContextSelectorJson, aidtContextSnapshotJson, type AidtContextApplicationInput, type AidtContextErrorCode as ContextErrorCode } from "@repo/contracts/aidt-run-context";
import { computeContentHash } from "../../domain/artifact/content-hash";
import type { OrgId } from "../../domain/org-id";
import type { AidtRunContextExecutionPort } from "../aidt-run-context/ports";
import { assertCurrentRunLease } from "./run-lease";
import { ModelCallError, type ClaimedAgentRun, type ReferenceDispatchObserver, type ThreadHistoryMessage } from "./ports";

const digest = (text: string) => computeContentHash(Buffer.from(text, "utf8"));
function mismatch(): never { throw new ModelCallError("MODEL_CALL_FAILED", "AIDT_CONTEXT_SNAPSHOT_MISMATCH"); }

/** Validate durable coordinates and canonical hashes, never a mutable stage head or client context. */
export function frozenAidtRunContext(orgId: OrgId, run: ClaimedAgentRun, authorized?: AidtStoredContextSnapshot): AidtStoredContextSnapshot | undefined {
  if (run.aidtSelectorHash == null) { if (run.aidtContext !== undefined) mismatch(); return undefined; }
  if (!run.aidtContext || !authorized) throw new ModelCallError("MODEL_CALL_FAILED", "AIDT_CONTEXT_SNAPSHOT_MISSING");
  const parsed = AidtStoredContextSnapshot.safeParse(authorized);
  if (!parsed.success) mismatch();
  const stored = parsed.data, snapshot = stored.snapshot;
  if (stored.orgId !== String(orgId) || stored.runId !== run.runId || stored.projectId !== run.projectId
    || stored.threadId !== run.threadId || stored.inputMessageId !== run.inputMessageId || stored.requestedBy !== run.requesterUserId
    || snapshot.selector.projectId !== stored.projectId || stored.selectorHash !== run.aidtSelectorHash
    || digest(aidtContextSelectorJson(snapshot.selector)) !== stored.selectorHash
    || digest(aidtContextSnapshotJson(snapshot)) !== stored.snapshotHash
    || digest(snapshot.modelReferenceBlock) !== snapshot.modelReferenceBlockHash
    || run.skillVersionIds.length !== 1 || run.skillVersionIds[0] !== snapshot.focus.skillVersionId) mismatch();
  return stored;
}

/** The reference is inserted after L1/L2 processing but before final attachment/source binding. */
export async function assembleAidtRunReference(input: {
  orgId: OrgId; run: ClaimedAgentRun; history: readonly ThreadHistoryMessage[]; attemptId: string;
  contexts?: AidtRunContextExecutionPort; receiptUnavailable?: () => void;
}): Promise<{ history: readonly ThreadHistoryMessage[]; observer?: ReferenceDispatchObserver; failed?: () => Promise<void> }> {
  if (input.run.aidtSelectorHash == null) { frozenAidtRunContext(input.orgId, input.run); return { history: input.history }; }
  const contexts = input.contexts;
  if (!contexts) throw new ModelCallError("MODEL_CALL_FAILED", "AIDT_CONTEXT_UNAVAILABLE");
  if (!input.run.aidtContext || input.run.projectId === null) throw new ModelCallError("MODEL_CALL_FAILED", "AIDT_CONTEXT_SNAPSHOT_MISSING");
  const actor = { userId: input.run.requesterUserId, projectId: input.run.projectId, threadId: input.run.threadId };
  let authorized: AidtStoredContextSnapshot;
  try { authorized = await contexts.resolve(input.orgId, actor, input.run.aidtContext); }
  catch (error) {
    const code = AidtContextErrorCode.safeParse(error && typeof error === "object" && "reasonCode" in error ? error.reasonCode : undefined);
    throw new ModelCallError("MODEL_CALL_FAILED", code.success ? code.data : "AIDT_CONTEXT_UNAVAILABLE");
  }
  const stored = frozenAidtRunContext(input.orgId, input.run, authorized)!;
  const append = async (event: AidtContextApplicationInput) => {
    try { await contexts.append(input.orgId, input.run.runId, event); } catch { input.receiptUnavailable?.(); }
  };
  let failureRecorded = false;
  const failed = async (errorCode: ContextErrorCode = "AIDT_CONTEXT_UNAVAILABLE") => {
    if (failureRecorded) return;
    failureRecorded = true;
    await append({ kind: "failed", attemptId: input.attemptId, snapshotHash: stored.snapshotHash, errorCode });
  };
  const revalidate = async () => {
    await assertCurrentRunLease();
    try { await contexts.revalidate(input.orgId, actor, stored); }
    catch (error) {
      const code = AidtContextErrorCode.safeParse(error && typeof error === "object" && "reasonCode" in error ? error.reasonCode : undefined);
      const errorCode = code.success ? code.data : "AIDT_CONTEXT_UNAVAILABLE";
      await failed(errorCode);
      throw new ModelCallError("MODEL_CALL_FAILED", errorCode);
    }
  };
  await revalidate();
  const snapshot = stored.snapshot;
  const resuming = input.run.pendingDecision !== null || input.run.checkpointResume === true;
  if (!resuming) await append({ kind: "assembled", attemptId: input.attemptId, snapshotHash: stored.snapshotHash, assembledContextHash: snapshot.modelReferenceBlockHash, formatterVersion: snapshot.formatterVersion });
  const reference: ThreadHistoryMessage = { role: "user", content: snapshot.modelReferenceBlock };
  return {
    history: [...input.history, reference],
    failed,
    observer: {
      historyIndex: input.history.length, contentSha256: snapshot.modelReferenceBlockHash, maxSerializedMessageBytes: AIDT_CONTEXT_LIMITS.referenceMessageBytes, beforeDispatch: revalidate,
      onDispatched: async fact => {
        if (fact.contentSha256 !== snapshot.modelReferenceBlockHash || (fact.kind === "checkpoint-resume-observed") !== resuming) mismatch();
        await append(fact.kind === "message-dispatch-observed"
          ? { kind: fact.kind, attemptId: input.attemptId, snapshotHash: stored.snapshotHash, assembledContextHash: fact.contentSha256, formatterVersion: snapshot.formatterVersion, remoteRunId: fact.remoteRunId, remoteThreadId: fact.remoteThreadId }
          : { kind: fact.kind, attemptId: input.attemptId, snapshotHash: stored.snapshotHash, inheritedMessageDispatchAttemptId: null, assembledContextHash: null, remoteRunId: fact.remoteRunId, remoteThreadId: fact.remoteThreadId });
      },
    },
  };
}
