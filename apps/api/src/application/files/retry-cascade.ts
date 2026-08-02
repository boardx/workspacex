/**
 * F46 -- `retryCascade` (N-17: "半完成的删除比不删更危险，不得标为完成，须重试").
 *
 * ## Why this almost always throws `CASCADE_TARGET_UNAVAILABLE` in phase-01
 *
 * The five local cascades (`invalidateLocalCascades`) are idempotent plain SQL against
 * tables this process owns -- re-running them against an already-invalidated artifact just
 * re-applies the same statements (see `request-deletion.ts`'s header). The sixth,
 * `ontology-edges`, is the F47 outbound port, and `files-outbound-stubs.ts`'s own rule is
 * that the phase-01 stub NEVER returns success. So a retry in phase-01 can only ever fail
 * the exact same way the original attempt did -- which is the HONEST answer (matching
 * `KNOWN_CONTRACT_GAPS.FS11`), not a bug in this file: retrying does not manufacture a
 * phase-02 module that does not exist yet.
 *
 * ⚠ `retryCascade.err` includes `DELETION_PARTIAL_FAILURE` -- used here for "there is
 * nothing to retry" (no such task, or it is not currently `partial-failure`), collapsing an
 * otherwise-missing NOT_FOUND-shaped reason into the one code the signed contract has room
 * for on this operation (same discipline `requestDeletion`'s `PROJECT_ROLE_INSUFFICIENT`
 * collapse already uses for a different pair of outcomes).
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { CascadeTargetUnavailableError, phase01OutboundStubs } from "@repo/contracts/files-outbound-stubs";
import type { OutboundPortImpl } from "@repo/contracts/files-outbound-stubs";
import { deriveLogicalCascadeStatus, type CascadeResultEntry } from "../../domain/files/deletion-cascade";
import type { OrgId } from "../../domain/org-id";
import type { LegalHoldGate, CascadeInvalidationRepository, DeletionTaskRepository } from "./deletion-ports";
import type { RetryCascadeRepository } from "./retry-cascade-ports";

export type RetryCascadeResult = z.infer<typeof C.operations.retryCascade.out>;

export type RetryCascadeReasonCode = "DELETION_PARTIAL_FAILURE" | "CASCADE_TARGET_UNAVAILABLE" | "LEGAL_HOLD_ACTIVE";

export class RetryCascadeError extends Error {
  constructor(readonly reasonCode: RetryCascadeReasonCode) {
    super("retry_cascade_failed");
  }
}

export interface RetryCascadeDeps {
  readonly tasks: DeletionTaskRepository;
  readonly retry: RetryCascadeRepository;
  readonly cascades: CascadeInvalidationRepository;
  readonly legalHold: LegalHoldGate;
  readonly invalidateOntologyEdges?: OutboundPortImpl;
}

export interface RetryCascadeInput {
  readonly orgId: OrgId;
  readonly taskId: string;
}

export async function retryCascade(deps: RetryCascadeDeps, input: RetryCascadeInput): Promise<RetryCascadeResult> {
  const task = await deps.tasks.getTask(input.orgId, input.taskId);
  if (task === null || task.status !== "partial-failure") {
    throw new RetryCascadeError("DELETION_PARTIAL_FAILURE");
  }

  // A hold landing between the original failed attempt and this retry must block it, same
  // as a fresh `requestDeletion` would (R3.d).
  if (await deps.legalHold.isActive(input.orgId, task.artifactId)) {
    throw new RetryCascadeError("LEGAL_HOLD_ACTIVE");
  }

  const local = await deps.cascades.invalidateLocalCascades({ orgId: input.orgId, artifactId: task.artifactId });

  const invalidateOntologyEdges = deps.invalidateOntologyEdges ?? phase01OutboundStubs.invalidateOntologyEdges;
  let ontologyResult: CascadeResultEntry;
  if (local.versionIds.length === 0) {
    ontologyResult = { kind: "ontology-edges", result: "ok", detail: "no versions to invalidate edges against" };
  } else {
    try {
      await invalidateOntologyEdges({ artifactId: task.artifactId, versionIds: local.versionIds });
      ontologyResult = { kind: "ontology-edges", result: "ok", detail: null };
    } catch (e) {
      if (e instanceof CascadeTargetUnavailableError) {
        ontologyResult = { kind: "ontology-edges", result: "failed", detail: e.message };
      } else {
        throw e;
      }
    }
  }

  const cascadeResults: readonly CascadeResultEntry[] = [...local.results, ontologyResult];
  const status = deriveLogicalCascadeStatus(cascadeResults);

  await deps.retry.updateCascadeResults(input.orgId, input.taskId, cascadeResults);
  await deps.retry.updateStatus(input.orgId, input.taskId, status);

  if (status === "partial-failure") {
    // Honest phase-01 answer (see file header): the retry itself did not close the gap, so
    // it fails LOUDLY rather than returning a 200 that reads as "retried, still broken" --
    // matching the contract's own `CASCADE_TARGET_UNAVAILABLE` reason for exactly this case.
    throw new RetryCascadeError("CASCADE_TARGET_UNAVAILABLE");
  }

  return { status, cascadeResults: cascadeResults.map((r) => ({ kind: r.kind, result: r.result })) };
}
