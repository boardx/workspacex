/**
 * The two shapes every artifact-bundle audit record has to take, in ONE place (F08).
 *
 * ## Why this is a module and not four `provenance.append(...)` calls
 *
 * The overview's 5.1 makes F08 the single collection point for audit writes -- "downstream
 * write operations do not each plant their own instrumentation". Four call sites spelling
 * their own `detail` bags is exactly that instrumentation, and it fails in a specific way:
 * the audit query is "who bound what, in which mode", and if `bindToProjectStep` writes
 * `{mode}` while `upgradeBinding` writes `{bindingMode}` the query answers one of them and
 * silently omits the other. Nothing goes red; the trail is just quietly incomplete.
 *
 * ## Where the event points, and why it is not always the most specific object
 *
 * R12 V7 fixes this, and it is worth stating because the choice looks arbitrary otherwise:
 *
 *   > 每次定版与绑定可按操作者、时间、**Artifact**、模式检索
 *
 * So a pin and a bind must both be findable BY ARTIFACT, and `queryProvenance` filters on
 * `(targetKind, targetId)` with no join available. A `pinned` event targeting the VERSION --
 * which is the more specific object, and the tempting choice -- makes "show me everything
 * that happened to this artifact" return nothing at all. Both therefore target the artifact,
 * and the version id travels in `detail`.
 *
 * `evidence-withdrawn` goes the other way for the same reason read backwards: the question a
 * reference site asks is "was THIS snapshot withdrawn", which is a lookup by version id.
 *
 * The rule, then: **the target is whatever the acceptance criterion says you search by.**
 * The residual cost is that no single query returns an artifact's events together with its
 * versions' events; that is a gap in the shared query surface and is reported as one.
 */
import type { OrgId } from "../../domain/org-id";
import type { BindingModeName } from "../../domain/artifact/binding-modes";
import type { ProvenanceWriter } from "./ports";

/** What a caller was refused, in the vocabulary the identity bundle already uses. */
export type RefusalReason =
  | "NO_PROJECT_ROLE"
  | "PROJECT_ROLE_INSUFFICIENT"
  | "CANNOT_DOWNGRADE"
  | "SNAPSHOT_IMMUTABLE";

export interface BindingAuditInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly artifactId: string;
  readonly bindingId: string;
  readonly projectId: string;
  readonly stepId: string;
  readonly mode: BindingModeName;
  readonly pinnedVersionId: string | null;
  /** Absent when the binding was created by this action rather than raised. */
  readonly previousMode?: BindingModeName;
}

/**
 * A backflow action that succeeded: `bound` for a bind or a publish, `pinned` for a freeze.
 *
 * The type is DERIVED from the resulting mode rather than passed in. Passing it would let a
 * caller record a pin as a bind, and the two are the ones V7 separates.
 */
export async function recordBackflow(
  writer: ProvenanceWriter,
  input: BindingAuditInput,
): Promise<string> {
  return writer.append({
    orgId: input.orgId,
    type: input.mode === "pinned" ? "pinned" : "bound",
    actorId: input.actorId,
    target: { kind: "artifact", id: input.artifactId },
    detail: {
      bindingId: input.bindingId,
      projectId: input.projectId,
      stepId: input.stepId,
      mode: input.mode,
      pinnedVersionId: input.pinnedVersionId,
      ...(input.previousMode === undefined ? {} : { previousMode: input.previousMode }),
    },
  });
}

export interface UnauthorizedAttemptInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  /** What the caller ADDRESSED -- recorded whether or not it exists. See below. */
  readonly target: { readonly kind: "artifact" | "artifact-version" | "project"; readonly id: string };
  /** The operation attempted, named as the use case names it. */
  readonly action: string;
  readonly reasonCode: RefusalReason;
}

/**
 * A refused action (R12 V7's second half, V8).
 *
 * ## Recorded even when the target does not exist, and that is the point
 *
 * The obvious optimisation -- only audit refusals against real objects -- reintroduces the
 * enumeration oracle from the other side: an attacker who can tell "audited" from
 * "not audited" (by response time, by a later trail read, by anything) learns which ids are
 * real. The refusal is recorded for what was ADDRESSED, so the two cases are identical on
 * the wire AND identical in the trail's existence, differing only in a field the attacker
 * cannot read.
 *
 * ## Failure here fails the request
 *
 * Deliberately not swallowed by the callers. "Best effort auditing" means the trail is
 * complete exactly until the moment something goes wrong, which is the moment it matters;
 * an unrecorded refusal is not a refusal this system is willing to return. The caller sees a
 * 500 rather than a 403, which is a worse day for an honest client and no help at all to a
 * prober -- it is not a signal about the resource.
 */
export async function recordUnauthorizedAttempt(
  writer: ProvenanceWriter,
  input: UnauthorizedAttemptInput,
): Promise<string> {
  return writer.append({
    orgId: input.orgId,
    type: "unauthorized-attempt",
    actorId: input.actorId,
    target: input.target,
    detail: { action: input.action, reasonCode: input.reasonCode },
  });
}
