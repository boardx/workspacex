/**
 * F45 -- `requestDeletion`: delete confirmation + the six-category cascade + the two-tier
 * SLA (uc-22-4 R3.c step 8-9, R7, R9, D-15, N-17).
 *
 * ## Why the six cascade outcomes are computed in TWO separate steps, not one transaction
 *
 * Cascades ①②③④⑥ are plain SQL against tables this process owns (`CascadeInvalidation
 * Repository.invalidateLocalCascades`, ONE `withTenant` transaction -- see that port's
 * header). Cascade ⑤ (`ontology-edges`) is a call across a PROCESS BOUNDARY -- the F47
 * outbound port, provided by 09-kg in phase-02 and, in phase-01, ALWAYS a stub that throws
 * `CascadeTargetUnavailableError` (`files-outbound-stubs.ts`'s own rule: "桩绝不返回成功").
 *
 * If cascade ⑤ ran INSIDE the same database transaction as ①②③④⑥, a thrown error there
 * would roll back the whole transaction -- undoing four cascades that succeeded and reporting
 * the browser entry as still present, which is a worse outcome than "logically invalidated,
 * minus the one category phase-02 does not exist yet to serve" (exactly what
 * `KNOWN_CONTRACT_GAPS.FS11` describes as the feature's biggest external risk, made concrete).
 * So: commit the five local cascades FIRST, then attempt the outbound call, then persist ALL
 * SIX outcomes (task + `deletion_cascade_results`) together. A crash between the two leaves
 * the artifact already logically gone from the browser with no task row yet -- reported as a
 * known gap below rather than solved by a two-phase commit this feature does not need to
 * invent (retrying `requestDeletion` is idempotent: a second call's `invalidateLocalCascades`
 * simply re-applies the same UPDATE/DELETE statements against an already-invalidated state).
 *
 * ## Why `overallStatus` can never be `"done"` here
 *
 * See `domain/files/deletion-cascade.ts`'s header. Today, `ontology-edges` is ALWAYS
 * `"failed"` (the stub's contract), so `requestDeletion` always produces `"partial-failure"`
 * in phase-01 -- and per N-17, NO receipt is issued and the artifact stays in the trash
 * queue for a human to retry once 09-kg exists. That is not a bug in this feature; it is
 * `FS11` made observable rather than papered over with a fake success.
 */
import { files as C } from "@repo/contracts";
import type { OutboundPortImpl } from "@repo/contracts/files-outbound-stubs";
import { CascadeTargetUnavailableError, phase01OutboundStubs } from "@repo/contracts/files-outbound-stubs";
import type { z } from "zod";
import {
  deriveLogicalCascadeStatus,
  logicalInvalidationDeadline,
  physicalDeletionDeadline,
  type CascadeResultEntry,
} from "../../domain/files/deletion-cascade";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { IdFactory } from "../artifact/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type {
  CascadeInvalidationRepository,
  DeleteImpactRepository,
  DeletionTaskRepository,
  LegalHoldGate,
} from "./deletion-ports";

export type RequestDeletionResult = z.infer<typeof C.operations.requestDeletion.out>;

/**
 * The write action `requestDeletion`/`previewDeleteImpact` are judged against -- see
 * `domain/identity/project-role-matrix.ts`'s `artifact.requestDeletion` for the judgment
 * call this action name and its facilitator-only grant represent.
 */
export const DELETE_ACTION = "artifact.requestDeletion";

export type RequestDeletionReasonCode =
  | "ARTIFACT_NOT_FOUND"
  | "PROJECT_ROLE_INSUFFICIENT"
  | "AGENT_CANNOT_DELETE"
  | "LEGAL_HOLD_ACTIVE";

export class RequestDeletionError extends Error {
  constructor(readonly reasonCode: RequestDeletionReasonCode) {
    super("request_deletion_failed");
  }
}

export interface RequestDeletionDeps extends AuthorizeDeps {
  readonly impact: DeleteImpactRepository;
  readonly legalHold: LegalHoldGate;
  readonly cascades: CascadeInvalidationRepository;
  readonly tasks: DeletionTaskRepository;
  readonly provenance: ProvenanceWriter;
  readonly idFactory: IdFactory;
  readonly now: () => Date;
  /**
   * Retention parameter this org/project has configured for `trashGraceDays` (O-01, N-20).
   * Injected rather than read from a hardcoded 30 -- see `deletion-cascade.ts`'s
   * `physicalDeletionDeadline` header for why this must not be a second literal.
   */
  readonly trashGraceDays: (orgId: OrgId, projectId: string | null) => Promise<number>;
  /**
   * The `ontology-edges` outbound port (F47). Defaults to the phase-01 stub, which is
   * guaranteed to throw `CascadeTargetUnavailableError` -- see the file header for why that
   * is the honest phase-01 answer rather than something this file should paper over.
   * Overridable so a test (or, eventually, phase-02) can substitute a real implementation.
   */
  readonly invalidateOntologyEdges?: OutboundPortImpl;
}

export interface RequestDeletionInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly reason: string;
  readonly scope: string | null;
  readonly confirmedImpact: true;
  /** D-39: agent-initiated deletion is refused unconditionally. */
  readonly actorKind: "user" | "agent";
}

export async function requestDeletion(
  deps: RequestDeletionDeps,
  input: RequestDeletionInput,
): Promise<RequestDeletionResult> {
  // Unconditional, resource-independent bar -- checked first, and it discloses nothing about
  // whether `artifactId` exists (D-39 / usecases.md 「agent 不得发起删除」).
  if (input.actorKind === "agent") throw new RequestDeletionError("AGENT_CANNOT_DELETE");

  // The contract's `confirmedImpact: z.literal(true)` and `reason: z.string().min(4)` already
  // make these unconstructible at the type level; this is the same defensive re-check
  // `withdraw-participant-phone.ts` does for `ackImpact` -- not trusting a caller that
  // bypasses TypeScript to call this function directly.
  if (input.confirmedImpact !== true || input.reason.trim().length < 4) {
    throw new RequestDeletionError("PROJECT_ROLE_INSUFFICIENT");
  }

  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  const found = await deps.impact.findDeletable({
    orgId: input.orgId,
    artifactId: input.artifactId,
    requesterTeamId: membership?.teamId ?? null,
  });
  if (!found) throw new RequestDeletionError("ARTIFACT_NOT_FOUND");

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: found.projectId ?? undefined,
    object: { kind: "artifact", id: found.artifactId },
    action: DELETE_ACTION,
  });
  // Contract's `requestDeletion.err` has no `NO_PROJECT_ROLE` -- both denial outcomes collapse
  // to `PROJECT_ROLE_INSUFFICIENT`, the same judgment call `renameArtifact` makes (see that
  // file's header).
  if (!decision.allowed) throw new RequestDeletionError("PROJECT_ROLE_INSUFFICIENT");
  if (!isDisclosed(discloseDecided(found.artifact, decision))) {
    throw new RequestDeletionError("PROJECT_ROLE_INSUFFICIENT");
  }

  if (await deps.legalHold.isActive(input.orgId, found.artifactId)) {
    throw new RequestDeletionError("LEGAL_HOLD_ACTIVE");
  }

  const requestedAt = deps.now();
  const trashGraceDays = await deps.trashGraceDays(input.orgId, found.projectId);

  // Cascades ①②③④⑥ -- one local transaction. See the file header for why ⑤ is NOT in here.
  const local = await deps.cascades.invalidateLocalCascades({
    orgId: input.orgId,
    artifactId: found.artifactId,
  });

  // Cascade ⑤, attempted SEPARATELY so its failure cannot roll back the four that succeeded.
  const invalidateOntologyEdges = deps.invalidateOntologyEdges ?? phase01OutboundStubs.invalidateOntologyEdges;
  let ontologyResult: CascadeResultEntry;
  if (local.versionIds.length === 0) {
    // No version to invalidate edges against -- an artifact this deletable should always
    // have at least one (file-first: STORED implies a version exists), so this is reported
    // rather than silently treated as success.
    ontologyResult = { kind: "ontology-edges", result: "ok", detail: "no versions to invalidate edges against" };
  } else {
    try {
      await invalidateOntologyEdges({ artifactId: found.artifactId, versionIds: local.versionIds });
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

  const taskId = deps.idFactory.next("del");
  await deps.tasks.create({
    id: taskId,
    orgId: input.orgId,
    artifactId: found.artifactId,
    requestedBy: input.userId,
    actorKind: input.actorKind,
    reason: input.reason,
    scope: input.scope,
    requestedAt,
    logicalInvalidationDeadline: logicalInvalidationDeadline(requestedAt),
    physicalDeletionDeadline: physicalDeletionDeadline(requestedAt, trashGraceDays),
    status,
    cascadeResults,
  });

  await deps.provenance.append({
    orgId: input.orgId,
    type: "deletion-requested",
    actorId: input.userId,
    target: { kind: "artifact", id: found.artifactId },
    detail: { taskId, reason: input.reason, scope: input.scope, status },
  });

  return {
    taskId,
    logicalInvalidationDeadline: logicalInvalidationDeadline(requestedAt).toISOString(),
    physicalDeletionDeadline: physicalDeletionDeadline(requestedAt, trashGraceDays).toISOString(),
  };
}
