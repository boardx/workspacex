/**
 * `ResolveResourceScope` — F07 / phase-01 `org-admin` · uc-1-4 R3 · coverage V6.
 *
 * ## This file is a CALL SITE, not a second judgement
 *
 * `contracts/org-admin/usecases.md` says it in as many words: 「判定实现属 phase-00
 * identity 的 Authorize；本用例是它在本束场景下的**调用契约**，不是第二个实现」。
 * So everything here is wiring: read who is asking, read what they asked about, hand both
 * to `decideCapabilityVisibility` (phase-00 F15, which itself delegates to `decide`), and
 * return the decision unchanged.
 *
 * If you find yourself comparing two team ids in this file, stop — that comparison lives in
 * `domain/identity/permission-decision.ts` and a copy here is the seventh instance of one
 * fact in two places.
 *
 * ## Why a capability, and not `authorize()`
 *
 * The two resource kinds F07 names — `agent` and `canvas-template` — are CAPABILITY
 * LISTINGS (F15). Their visibility scope is a column on their own row, not an
 * `acl_bindings` row, which is exactly why `permission-filter.toAclRef` *throws* for
 * `kind: "capability"`: routing one through `authorize()` would find no binding, fall back
 * to the permissive `DEFAULT_SCOPE`, and return `allowed: true` for everybody with a
 * decision object that looks completely normal.
 *
 * ## Why an unknown resource is DENIED rather than reported missing
 *
 * uc-1-4 V13: a denial must not reveal whether the resource exists. If "no such agent"
 * answered differently from "another team's agent", this route would be an enumeration
 * oracle over the organization's whole configuration. So an unknown id is judged against
 * `UNSATISFIABLE_TEAM` — the sentinel `strictestScope` already uses for "no single team can
 * satisfy this" — and comes back as the same `ORG_SCOPE_DENIED` a wrong-team member gets.
 *
 * ⚠ The cost is real and is stated rather than hidden: a member of the OWNING team also
 * cannot distinguish "does not exist" from "exists but restricted" through this route. That
 * is the intended trade (V13 over diagnosability); the distinction they need is available on
 * `listCapabilities`, whose `withheld` half exists for precisely that.
 *
 * ## What this file deliberately does NOT do
 *
 * It does not look at, mention, or accept an MCP authorization scope
 * (`仅项目负责人 / 全体成员 / 待安全评审`). That is a DIFFERENT axis — "who may call this
 * server" — and `contracts/templates/design-signoff.md` X-8 / I-27 forbids merging it into
 * the visibility field. `out` is a bare `PermissionDecision`, whose `scopeLayer.scope` is
 * `identity.VisibilityScope` and nothing else.
 *
 * ⚠ It also does not attempt to reconcile the four coexisting visibility vocabularies
 * (`design-coherence.md` XC-05) — that is unruled and belongs to a human, not to F07.
 */
import {
  decideCapabilityVisibility,
  isCapabilityKind,
  type CapabilityKind,
} from "../../domain/identity/capability-listing";
import {
  UNSATISFIABLE_TEAM,
  type PermissionDecision,
} from "../../domain/identity/permission-decision";
import type { OrgId } from "../../domain/org-id";
import type { CapabilityRepository } from "../identity/capability-ports";
import type { DecisionIdFactory, IdentityRepository } from "../identity/ports";

export interface ResolveResourceScopeDeps {
  readonly repo: IdentityRepository;
  readonly capabilities: CapabilityRepository;
  readonly ids: DecisionIdFactory;
}

export interface ResourceRef {
  readonly kind: string;
  readonly id: string;
}

export interface ResolveResourceScopeInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly resource: ResourceRef;
}

/**
 * The contract types `resource.kind` as an open `z.string()`, so a kind this system has no
 * way to judge can arrive. Throwing beats denying: a kind nobody declared is a caller
 * mistake, and answering it with a normal-looking `ORG_SCOPE_DENIED` would let a typo
 * (`"canvas_template"`) read as a permission verdict forever.
 *
 * Same reasoning `permission-filter` already uses for an unregistered propagation path.
 */
export class UnjudgeableResourceKindError extends Error {
  constructor(readonly kind: string) {
    super(`resource kind "${kind}" is not a capability kind and has no visibility scope`);
    this.name = "UnjudgeableResourceKindError";
  }
}

/**
 * ⚠ Never throws for a denial. Authorization is explainable DATA (UC-0.3 R6): the whole
 * point of F07 is that the caller can read off WHICH LAYER closed the door, and an
 * exception discards exactly that.
 */
export async function resolveResourceScope(
  deps: ResolveResourceScopeDeps,
  input: ResolveResourceScopeInput,
): Promise<PermissionDecision> {
  const { repo, capabilities, ids } = deps;
  const { userId, orgId, resource } = input;

  if (!isCapabilityKind(resource.kind)) throw new UnjudgeableResourceKindError(resource.kind);
  const kind: CapabilityKind = resource.kind;

  const membership = await repo.findOrgMembership(userId, orgId);

  // Non-member: judged, not short-circuited. `decide()` returns NO_ORG_MEMBERSHIP from a
  // null org role, and reaching it WITHOUT reading the row means a non-member cannot learn
  // whether the id exists either.
  if (membership === null) {
    return decideCapabilityVisibility({
      decisionId: ids.next(),
      orgRole: null,
      requesterTeamId: null,
      scope: "team-only",
      ownerTeamId: UNSATISFIABLE_TEAM,
    });
  }

  // Read BY KIND rather than by id, so an id that exists under a different kind is absent
  // here — the caller asked about an agent, and "that id is actually a model" is still a
  // fact about the organization's configuration they may not be entitled to.
  //
  // ⚠ The rows come back as `GuardedCapability`: `facts` is the decision's input and is
  // never disclosed, and the listing payload is unreachable from this file at all. Nothing
  // about the resource crosses the boundary — only the verdict does.
  const rows = await capabilities.listByKind(orgId, kind);
  const facts = rows.find((r) => r.facts.id === resource.id)?.facts ?? null;

  return decideCapabilityVisibility({
    decisionId: ids.next(),
    orgRole: membership.orgRole,
    requesterTeamId: membership.teamId,
    scope: facts?.scope ?? "team-only",
    ownerTeamId: facts === null ? UNSATISFIABLE_TEAM : facts.ownerTeamId,
  });
}
