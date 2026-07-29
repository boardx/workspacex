/**
 * `ReadContent` -- the real read path, and the only one.
 *
 * This is where F03's three obligations become facts about a running system rather than
 * properties of a function:
 *
 *   1. an admin with no project role is refused HERE, by asking `decide()` like everybody
 *      else -- being an admin is not an input to the answer;
 *   2. the personal layer is never reachable through this path for anyone but its owner;
 *   3. an audit-purpose read writes `provenance_events` BEFORE the body is returned.
 *
 * ## Why the trail is written before the body is loaded
 *
 * The tempting order is "read, return, log". It is wrong: any failure after the return --
 * a dropped connection, a full disk, an exception in a later branch -- produces an access
 * with no record, and nothing anywhere reports it. R4 A1 permits the read BECAUSE it is
 * recorded, so the record has to be the precondition, not the epilogue.
 *
 * Consequence, stated because it is a real trade-off: a read whose trail cannot be
 * persisted FAILS. An admin will occasionally see an error where they expected content.
 * That is the correct direction to fail in -- the alternative is content delivered off the
 * record, which is indistinguishable from the boundary not existing.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import { decideContentRead, type ReadPurpose } from "../../domain/identity/admin-boundary";
import type { PermissionReason } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "./authorize";
import type { ContentRepository } from "./content-ports";
import type { ProvenanceWriter } from "../provenance/ports";

/** Derived from the contract, never restated. */
export type ReadContentResult = z.infer<typeof identity.operations.readContent.out>;

/**
 * Denied, with the layered reason the UI needs (UC-0.3 R8: never just "no permission").
 * `interface` decides which HTTP status each reason becomes -- that mapping is protocol,
 * and this layer does not know HTTP exists.
 */
export class ContentDeniedError extends Error {
  constructor(readonly reasonCode: PermissionReason) {
    super("content_denied");
  }
}

/**
 * No such item -- OR a draft belonging to somebody else. One error type for both, because
 * the whole requirement is that the caller cannot tell them apart (uc-0-1 V4).
 */
export class ContentNotFoundError extends Error {
  constructor() {
    super("content_not_found");
  }
}

export interface ReadContentDeps extends AuthorizeDeps {
  readonly content: ContentRepository;
  readonly provenance: ProvenanceWriter;
}

export interface ReadContentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly itemId: string;
  readonly purpose: ReadPurpose;
}

/**
 * The action a content read is judged as.
 *
 * `read.allHands` rather than `read.published`, deliberately: it is the stricter of the
 * two read surfaces an ordinary participant holds, so an observer (whose row is
 * `read.published` alone) does not reach project content through this endpoint. Picking
 * the loosest action here would have quietly widened the observer role, and nothing in the
 * role matrix would have changed to say so.
 */
const CONTENT_READ_ACTION = "read.allHands";

export async function readContent(
  deps: ReadContentDeps,
  input: ReadContentInput,
): Promise<ReadContentResult> {
  const { repo, content, provenance, ids } = deps;
  const { userId, orgId, projectId, itemId, purpose } = input;

  const [facts, membership, baseDecision] = await Promise.all([
    content.findItemFacts(orgId, itemId),
    repo.findOrgMembership(userId, orgId),
    authorize({ repo, ids }, {
      userId,
      orgId,
      projectId,
      object: { kind: "artifact", id: itemId },
      action: CONTENT_READ_ACTION,
    }),
  ]);

  const outcome = decideContentRead({
    item: facts,
    requesterId: userId,
    orgRole: membership?.orgRole ?? null,
    purpose,
    baseDecision,
  });

  if (outcome.kind === "not-found") throw new ContentNotFoundError();
  if (outcome.kind === "deny") throw new ContentDeniedError(outcome.reasonCode);

  // `facts` is non-null here: `decideContentRead` returns not-found when it is null. The
  // check is kept so a future edit to the rule order cannot turn this into a crash.
  if (facts === null) throw new ContentNotFoundError();

  let provenanceEventId: string | null = null;
  if (outcome.auditTrailRequired) {
    // Fails loudly on purpose -- see the header. No try/catch: swallowing this would turn
    // "every access is logged" into "every access is logged unless the log was busy".
    provenanceEventId = await provenance.append({
      orgId,
      type: "admin-project-access",
      actorId: userId,
      // Target is the PROJECT, not the item. The question the project lead asks is "who
      // has been reading my project", and a per-item target makes that a scan across
      // every item id they would first have to enumerate.
      target: { kind: "project", id: projectId },
      detail: { itemId, purpose, action: CONTENT_READ_ACTION, decisionId: baseDecision.decisionId },
    });
  }

  const body = await content.findItemBody(orgId, itemId);
  if (body === null) throw new ContentNotFoundError();

  return { itemId, layer: facts.layer, status: facts.status, body, provenanceEventId };
}
