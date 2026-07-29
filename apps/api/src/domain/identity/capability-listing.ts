/**
 * The capability listing rules (F15 / uc-0-5 R3 R7).
 *
 * Innermost layer: no HTTP, no SQL, no clock. Every type here is DERIVED from the contract
 * -- restating the six kinds or the listing's shape would be the same-fact-twice failure
 * this project has hit six times.
 *
 * ## What this file deliberately does NOT contain
 *
 * A list of agents. A list of models. A "recommended starter set". Any of those would be
 * the product built-in that the whole feature exists to remove: the prototype's six agents
 * and eighteen models are ONE organization's example configuration (uc-0-5 R2 note), and
 * the moment a default lives in code, the second customer's installation is a code change.
 * `no-builtin-capability-lists.test.ts` asserts this mechanically rather than trusting the
 * comment.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import { decide, type PermissionDecision } from "./permission-decision";
import type { OrgRole, VisibilityScope } from "./roles";

/** Derived, never restated. */
export type CapabilityKind = z.infer<typeof identity.CapabilityKind>;
export type CapabilityListing = z.infer<typeof identity.CapabilityListing>;
export type MutateCapabilityOp = z.infer<typeof identity.operations.mutateCapability.in>["op"];

/**
 * D-U5's two interruption modes.
 *
 * Derived from the contract because the choice reaches the user: the confirmation dialog
 * offers exactly these two, and `affectedInFlightCalls` tells them what the first one costs.
 */
export type DisableMode = NonNullable<
  z.infer<typeof identity.operations.mutateCapability.in>["disableMode"]
>;

/**
 * `interrupt`, not `drain`, when the caller says nothing.
 *
 * The two motives for disabling are a security incident (cut it now) and a version
 * retirement (let it finish). Only one of those is unsafe to get wrong, so the default is
 * the one that is merely inconvenient when it was not needed (uc-0-5 R4 A3).
 */
export const DEFAULT_DISABLE_MODE: DisableMode = "interrupt";

export const CAPABILITY_KINDS = identity.CapabilityKind.options;

export function isCapabilityKind(v: unknown): v is CapabilityKind {
  return identity.CapabilityKind.safeParse(v).success;
}

/**
 * The action string a capability read is judged under.
 *
 * A capability is org-level configuration, so there is never a project context and the
 * project layer does not apply (I-11) -- which means `decide()` never consults this action.
 * It is passed anyway so the decision records what was being attempted; a decision whose
 * action field is empty is a decision nobody can interpret later.
 */
export const CAPABILITY_READ_ACTION = "capability.list";

export interface CapabilityVisibilityInput {
  readonly decisionId: string;
  /** null = not a member of this organization */
  readonly orgRole: OrgRole | null;
  readonly requesterTeamId: string | null;
  readonly scope: VisibilityScope;
  readonly ownerTeamId: string | null;
}

/**
 * Is this capability visible to this requester -- the SECOND of R3's two serial layers.
 *
 * ## Why it delegates to `decide()` instead of comparing two team ids itself
 *
 * The comparison is three lines. Writing those three lines here would be the seventh copy
 * of one fact, and worse, it would produce a verdict that is not a `PermissionDecision`:
 * no layered explanation, no reason code, nothing for the interface to say. R12 V10 is
 * explicit that "this organization has no such capability" and "this organization has it
 * but you are not in its team" must be DISTINGUISHABLE. That distinction is exactly the
 * difference between a row that is absent and a row that came back with
 * `reasonCode: "ORG_SCOPE_DENIED"` -- and only the shared decision function produces the
 * second one.
 *
 * `project: null` is the substantive part: capability configuration is org-level, so the
 * project layer does not apply at all (I-11), and `projectLayer` on the resulting decision
 * is null rather than a failed project check.
 */
export function decideCapabilityVisibility(input: CapabilityVisibilityInput): PermissionDecision {
  return decide({
    decisionId: input.decisionId,
    action: CAPABILITY_READ_ACTION,
    org: { role: input.orgRole, teamId: input.requesterTeamId },
    project: null,
    scope: { scope: input.scope, ownerTeamId: input.ownerTeamId },
  });
}

/**
 * Who may change the organization's configuration: the org admin, and nobody else.
 *
 * ## Why members cannot override, not even for themselves
 *
 * uc-0-5 R7 rules it out in one line, and the reason is worth keeping next to the code: the
 * capability list decides what an AI may read and which tools it may call. A personal
 * override is therefore a personal exemption from the organization's security boundary,
 * wearing the clothes of a preference. Personalisation is allowed only where no data
 * boundary is involved, which is not this.
 *
 * `lead` and `compliance` are deliberately excluded even though both are senior: seniority
 * is not the criterion, holding the configuration mandate is. Compliance in particular reads
 * everything and changes nothing.
 */
export function canMutateCapabilities(orgRole: OrgRole | null): boolean {
  return orgRole === "admin";
}
