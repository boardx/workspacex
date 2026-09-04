/**
 * The guarded read -- the single doorway between tenant data and anything that shows it
 * to a human (UC-0.3 R7, coherence X-1, artifact I-13).
 *
 * ## The problem this exists to make impossible
 *
 * R7 says a visibility scope must travel from an Artifact to its Segments, embeddings,
 * graph nodes, cached verdicts and Context Pack items. The failure mode is not malice; it
 * is a retrieval author writing `SELECT ... FROM segments WHERE org_id = $1` and shipping.
 * That query is tenant-correct and permission-blind: it returns a team-only artifact's
 * text to somebody in another team, and every test written about it passes.
 *
 * Documentation does not stop that. Code review does not reliably stop that. So the shape
 * of the API stops it: a repository does not hand back a row, it hands back `Guarded<T>`,
 * and there is no way to get `T` out of a `Guarded<T>` other than `disclose()`, which
 * demands a requester and produces a decision. Forgetting to authorize stops being an
 * omission and becomes a type error.
 *
 * ## Why the payload is held in a module-private WeakMap
 *
 * Not a `private` field (erased at runtime, reachable from JS), and not `#private` (which
 * would still show up in a debugger and, more importantly, is a property -- so a
 * `JSON.stringify` or a spread of a "denied" item would serialise the very content that
 * was withheld). With a WeakMap the object literally has no payload property: the wrapper
 * can be logged, serialised, or spread, and only its ref travels.
 *
 * ## What this does NOT do
 *
 * It does not enforce itself. A repository that ignores `guard()` and returns raw rows
 * compiles fine. `apps/api/scripts/lint-permission-paths.mjs` is the other half: any file
 * that names a tenant-carrying table in SQL must live in `infrastructure/` and go through
 * this module. Neither half is sufficient alone -- the type stops the accidental
 * disclosure, the lint stops the accidental bypass.
 */
import { strictestScope, type PermissionDecision } from "../../domain/identity/permission-decision";
import { isPropagationPath, type PropagationPathId } from "../../domain/identity/propagation-paths";
import type { OrgId } from "../../domain/org-id";
import { authorizeBatch, authorizeDerived, type AuthorizeDeps } from "../identity/authorize";
import type { AclObjectRef, ObjectRef } from "../identity/ports";

/**
 * Narrow a guarded item's ref to something `authorize` can actually judge.
 *
 * `disclose()` judges through `acl_bindings`, and a capability listing has no binding row --
 * its scope is a column on its own row (F15). Passing one here used to be possible and
 * silently harmless-looking: the binding lookup would find nothing and fall back to the
 * permissive default scope, so every capability would come back visible to everybody with a
 * decision object that looked entirely normal.
 *
 * Throwing is right rather than denying: this is a programming error (wrong doorway), not a
 * verdict, and the same reasoning the unregistered-path check already uses.
 */
function toAclRef(ref: ObjectRef): AclObjectRef {
  if (ref.kind === "capability") {
    throw new Error(
      `capability "${ref.id}" cannot be judged by authorize -- its scope is not in acl_bindings. ` +
        `Use decideCapabilityVisibility (domain/identity/capability-listing) and discloseDecided().`,
    );
  }
  /**
   * F22, and the failure it prevents is the SAME shape as `capability`'s, one notch worse.
   *
   * An organization has no `acl_bindings` row, so `authorize` would find nothing, fall back
   * to `DEFAULT_SCOPE` (org-wide), see a non-null org role, and return `allowed: true` --
   * for EVERY member. The export whose whole rule is "仅管理员" (O-29 ③) would be granted to
   * every consultant in the organization, with a perfectly normal-looking decision object
   * and a decisionId to match. The rule that does apply is `decideOrgExport`
   * (domain/auth/org-lifecycle.ts), unwrapped through `discloseDecided`.
   */
  if (ref.kind === "organization") {
    throw new Error(
      `organization "${ref.id}" cannot be judged by authorize -- it has no acl_bindings row, ` +
        `so authorize would allow every MEMBER. Use decideOrgExport (domain/auth/org-lifecycle) ` +
        `and discloseDecided().`,
    );
  }
  /**
   * F80，与上面两条同型，而且是其中后果最直接的一条。
   *
   * 一场 `project_id IS NULL` 的访谈没有 `acl_bindings` 行 ⇒ `authorize` 找不到绑定 ⇒
   * 退回 `DEFAULT_SCOPE`（org-wide）⇒ 看见非空的组织角色 ⇒ 返回 `allowed: true`。
   * 也就是说：**一场只有创建者能看的独立访谈，会对全组织每个人放行**，
   * 而那个 decision 对象长得完全正常、还带着一个 decisionId。这正是 I-31 说的
   * 「不因无项目而全组织可见」的反面。
   *
   * 适用的规则是 `decideInterviewVisibility`（domain/interview/visibility-decision），
   * 经 `discloseDecided` 取出载荷。
   */
  if (ref.kind === "interview") {
    throw new Error(
      `interview "${ref.id}" cannot be judged by authorize -- it has no acl_bindings row, ` +
        `so authorize would allow every member of the organization. Use ` +
        `decideInterviewVisibility (domain/interview/visibility-decision) and discloseDecided().`,
    );
  }
  /**
   * F97，与 `interview` 同型：一个访谈对象没有 `acl_bindings` 行 ⇒ `authorize`
   * 找不到绑定 ⇒ 退回宽松默认 scope ⇒ 对每个组织成员都放行——包括本该被 R5
   * 挡在门外的**观察者**。适用的规则是 `decideSubjectVisibility`
   * （application/interview/subject-visibility-decision），经 `discloseDecided` 取出载荷。
   */
  if (ref.kind === "subject") {
    throw new Error(
      `subject "${ref.id}" cannot be judged by authorize -- it has no acl_bindings row, ` +
        `so authorize would allow every member of the organization, including observers. Use ` +
        `decideSubjectVisibility (application/interview/subject-visibility-decision) and discloseDecided().`,
    );
  }
  if (ref.kind === "research") {
    throw new Error(
      `research "${ref.id}" cannot be judged by authorize -- guided research sessions have no ` +
        `acl_bindings row. Use decideGuidedResearchVisibility and discloseDecided().`,
    );
  }
  /*
   * FB-2. Same shape as `subject` / `research` above: a feedback row has no `acl_bindings`
   * row, so `authorize` would find no binding, fall back to the permissive default scope,
   * and hand every member of the organization somebody else's feedback body -- which is
   * exactly what D3 forbids. Throwing here forces the caller onto
   * `decideFeedbackDetailVisibility` + `discloseDecided()`.
   */
  if (ref.kind === "feedback") {
    throw new Error(
      `feedback "${ref.id}" cannot be judged by authorize -- feedback has no acl_bindings ` +
        `row, so authorize would allow every member of the organization to read the body. ` +
        `Use decideFeedbackDetailVisibility (application/feedback/feedback-detail-decision) ` +
        `and discloseDecided().`,
    );
  }
  /*
   * UC-17.8 B1.7. A draft has no `acl_bindings` row either, and its rule is narrower than
   * D3 (owner only -- not even administrators): `decideFeedbackDraftAttachmentVisibility`.
   */
  if (ref.kind === "feedback_draft") {
    throw new Error(
      `feedback_draft "${ref.id}" cannot be judged by authorize -- drafts have no acl_bindings ` +
        `row and are owner-private. Use decideFeedbackDraftAttachmentVisibility ` +
        `(application/feedback/drafts/draft-attachment-decision) and discloseDecided().`,
    );
  }
  return { kind: ref.kind, id: ref.id };
}

/**
 * Tenant data that has been read but NOT yet cleared for a requester.
 *
 * `ref` and `sources` are public because the caller needs them to plan work (batching,
 * ordering, counting). The content is not.
 */
export class Guarded<T> {
  constructor(
    readonly ref: ObjectRef,
    /**
     * Where this object's permission comes from when it is DERIVED (artifact I-13).
     *
     * Empty for a first-class object. For a Segment, an embedding row, a graph node or a
     * Context Pack item, it lists the originals -- and the effective scope is the
     * STRICTEST of them (I-7), never the union. Getting this backwards is the laundering
     * bug R7 describes, so it is a constructor argument rather than something a caller may
     * neglect to pass later.
     */
    readonly sources: readonly ObjectRef[] = [],
  ) {}
}

/** Module-private. Nothing outside this file can reach a payload. */
const PAYLOAD = new WeakMap<Guarded<unknown>, unknown>();

export function guard<T>(ref: ObjectRef, payload: T, sources: readonly ObjectRef[] = []): Guarded<T> {
  const g = new Guarded<T>(ref, sources);
  PAYLOAD.set(g, payload);
  return g;
}

export interface Disclosed<T> {
  readonly ref: ObjectRef;
  readonly payload: T;
  /** Goes into the Context Pack's items[] so "why were you shown this" is recoverable (R10 ④). */
  readonly permissionDecisionId: string;
}

export interface Withheld {
  readonly ref: ObjectRef;
  /** null when allowed -- never occurs here, but the decision type permits it. */
  readonly reasonCode: PermissionDecision["reasonCode"];
  readonly permissionDecisionId: string;
}

/**
 * Both halves are returned on purpose.
 *
 * `withheld` is not diagnostics: F11 has to render a reviewable discard list, and a filter
 * that silently drops rows leaves nothing to render. It also makes the assertion "zero
 * content reached the caller" distinguishable from "the query found nothing" -- the two
 * look identical if only the survivors come back.
 */
export interface Disclosure<T> {
  readonly visible: readonly Disclosed<T>[];
  readonly withheld: readonly Withheld[];
}

export interface DiscloseInput<T> {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId?: string;
  readonly action: string;
  /**
   * Which of the six R7 paths this call is. Required, and validated against the registry.
   *
   * It is not telemetry. Requiring it means a new read path cannot be built without
   * appearing in `PROPAGATION_PATHS`, which is where the coverage claim is made -- a path
   * that is not in the list cannot call this function at all.
   */
  readonly path: PropagationPathId;
  readonly items: readonly Guarded<T>[];
}

/**
 * Judge a batch of guarded items and return only what the requester may see.
 *
 * Never throws for a denial -- authorization is explainable data (UC-0.3 R6). It throws
 * only for an unregistered path, which is a programming error, not a verdict.
 *
 * One round trip for the non-derived items (X-1 / contract note on `authorizeBatch`): the
 * reason batch judgement exists is that per-item calls make the correct path the slow one,
 * and that is precisely how R7 gets hollowed out in practice.
 */
export async function disclose<T>(deps: AuthorizeDeps, input: DiscloseInput<T>): Promise<Disclosure<T>> {
  const { userId, orgId, projectId, action, path, items } = input;
  if (!isPropagationPath(path)) {
    throw new Error(
      `unknown propagation path "${path}" -- add it to PROPAGATION_PATHS (domain/identity) so V10 covers it`,
    );
  }
  if (items.length === 0) return { visible: [], withheld: [] };

  const plain = items.filter((i) => i.sources.length === 0);
  const derived = items.filter((i) => i.sources.length > 0);

  const decisions = new Map<Guarded<T>, PermissionDecision>();

  if (plain.length > 0) {
    const ds = await authorizeBatch(deps, {
      userId, orgId, projectId, action,
      objects: plain.map((i) => toAclRef(i.ref)),
    });
    // Same length, same ORDER -- guaranteed by the port, which is why nothing here matches
    // by id. Matching by id is where one item's content gets paired with another's verdict.
    plain.forEach((i, n) => decisions.set(i, ds[n]!));
  }

  for (const i of derived) {
    // Sequential rather than Promise.all: each call opens a tenant transaction, and a
    // hundred concurrent ones exhaust the pool. Derived batches are the smaller half; when
    // F09/F10 make them the larger half this becomes a batched strictest-scope lookup, and
    // `strictestScope` (imported below) is already the shared piece that would need.
    decisions.set(
      i,
      await authorizeDerived(deps, {
        userId, orgId, projectId, action,
        // ⚠ `authorizeDerived` requires `objects` (it extends AuthorizeBatchInput) and then
        // never reads it -- the scope comes entirely from `sources`. Passed as the item's
        // own ref so the argument is at least truthful. Flagged in the F02 report: a
        // required parameter that is ignored invites a caller to believe it is being
        // judged, which for a security function is the wrong belief to invite.
        objects: [toAclRef(i.ref)],
        sources: i.sources.map(toAclRef),
      }),
    );
  }

  const visible: Disclosed<T>[] = [];
  const withheld: Withheld[] = [];
  for (const item of items) {
    const d = decisions.get(item)!;
    if (d.allowed) {
      visible.push({ ref: item.ref, payload: PAYLOAD.get(item) as T, permissionDecisionId: d.decisionId });
    } else {
      withheld.push({ ref: item.ref, reasonCode: d.reasonCode, permissionDecisionId: d.decisionId });
    }
  }
  return { visible, withheld };
}

/**
 * Unwrap a guarded item using a decision that was ALREADY made elsewhere.
 *
 * ## Why this exists
 *
 * `disclose()` judges via `authorize`/`authorizeBatch`. Some reads need a richer rule that
 * `authorize` does not express -- F03's `decideContentRead` folds in the personal-layer
 * boundary, the admin-not-superuser rule and the audit purpose, and those cannot be
 * reduced to an action string.
 *
 * The wrong resolution is to let such a read bypass the guard, because then there are TWO
 * doorways between tenant data and a human, and the one nobody is looking at is the one
 * that leaks. (F02 and F03 were built in parallel and each shipped its own mechanism; the
 * merge is what surfaced it. Both were green alone.)
 *
 * So: one doorway, two decision sources. The payload still cannot be reached except
 * through this module, and the decision is still the thing that decides.
 *
 * ⚠ The caller supplies the decision, so this function cannot verify the rule was the
 * right one -- it verifies only that a decision was made and consulted. That is a real
 * limit, and it is why the decision-producing functions live in `domain/` where they are
 * tested directly.
 */
export function discloseDecided<T>(item: Guarded<T>, decision: PermissionDecision): Disclosed<T> | Withheld {
  if (!decision.allowed) {
    return { ref: item.ref, reasonCode: decision.reasonCode, permissionDecisionId: decision.decisionId };
  }
  return { ref: item.ref, payload: PAYLOAD.get(item) as T, permissionDecisionId: decision.decisionId };
}

/** Narrow a `discloseDecided` result. */
export function isDisclosed<T>(r: Disclosed<T> | Withheld): r is Disclosed<T> {
  return "payload" in r;
}

/**
 * The cache key for a verdict (R7's sixth path).
 *
 * Every axis the decision depends on is in the key, in a fixed order. A key missing `org`
 * is the classic cross-tenant cache hit: same user, same object id, different
 * organization, and the previous organization's answer is served without a query -- so no
 * RLS policy is consulted and nothing looks wrong. O-12 additionally requires that
 * switching organizations reuses NO prior judgement, which `invalidateUser` handles; this
 * key means even a missed invalidation cannot cross tenants.
 *
 * `userId` comes first because `AuthorizationCache` buckets by the segment before the
 * first `|`.
 */
export function decisionCacheKey(input: {
  userId: string;
  orgId: OrgId;
  projectId?: string;
  path: PropagationPathId;
  action: string;
  ref: ObjectRef;
}): string {
  return [
    input.userId,
    input.orgId,
    input.projectId ?? "-",
    input.path,
    input.action,
    `${input.ref.kind}:${input.ref.id}`,
  ].join("|");
}

/**
 * Re-exported so a consumer computing an effective scope for storage (F04 stamping a
 * Segment) uses the SAME function the filter uses. A second "take the stricter one"
 * helper would be the seventh instance of one fact in two places.
 */
export { strictestScope };
