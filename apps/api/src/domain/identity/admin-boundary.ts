/**
 * The admin boundary. This function IS feature F03.
 *
 * Pure: no clock, no I/O, no storage. It takes the facts about an item, the requester's
 * org role, the stated purpose of the read, and the two-layer verdict from `decide()`,
 * and answers what happens.
 *
 * ## Why it is a separate function from `decide()`
 *
 * `decide()` answers "does the two-layer intersection allow this action". That is not the
 * whole question for a content read, because three of the rules here are not about roles
 * at all:
 *
 *   * the personal layer is closed to everyone but its owner -- ROLE IS IRRELEVANT
 *   * a draft is invisible to everyone but its creator -- ROLE IS IRRELEVANT
 *   * an audit-purpose read by an admin is allowed, and obliges a trail
 *
 * Folding these into `decide()` would mean the intersection sometimes overrides itself,
 * and "when does the permission function not mean what it returns" is not a question
 * anybody should have to hold in their head.
 *
 * ## The order of the rules is load-bearing
 *
 * Draft invisibility is checked BEFORE the audit exemption. Reversed, an admin's audit
 * read would return other people's drafts -- and uc-0-1 R5 puts drafts on the same footing
 * as the personal layer: "creator only, project admins and org admins included".
 */
import type { OrgRole, PermissionReason } from "./roles";
import type { PermissionDecision } from "./permission-decision";
import { identity } from "@repo/contracts";
import type { z } from "zod";

/** Derived from the contract, never restated (`lint-contract-source` enforces it). */
export type ContentLayer = z.infer<typeof identity.ContentLayer>;
export type ContentStatus = z.infer<typeof identity.ContentStatus>;
export type ReadPurpose = z.infer<typeof identity.ReadPurpose>;

/** The facts about a stored item that the boundary rule needs. Note: no body. */
export interface ContentItemFacts {
  readonly layer: ContentLayer;
  readonly status: ContentStatus;
  readonly ownerUserId: string;
}

/**
 * `not-found` is a verdict, not an absence.
 *
 * A draft belonging to someone else and an item that was never created have to be
 * indistinguishable from outside (uc-0-1 V4: "404, not 403"). Returning 403 for the draft
 * would answer the question "is there something here I am not allowed to see", and for a
 * draft that question is itself the leak.
 */
export type ContentReadOutcome =
  | { readonly kind: "allow"; readonly auditTrailRequired: boolean }
  | { readonly kind: "deny"; readonly reasonCode: PermissionReason }
  | { readonly kind: "not-found" };

export interface ContentReadInput {
  /** null = no such item in this tenant */
  readonly item: ContentItemFacts | null;
  readonly requesterId: string;
  /** null = not a member of this organization */
  readonly orgRole: OrgRole | null;
  readonly purpose: ReadPurpose;
  /** The two-layer intersection for this item, from `decide()` */
  readonly baseDecision: PermissionDecision;
}

/**
 * Who may read project content on audit grounds.
 *
 * ADMIN ONLY -- and specifically NOT `compliance`, which is the one people get wrong.
 * UC-0.3 R5 gives the compliance officer the audit CHAIN (retention queues, egress
 * records, `provenance_events`) and then says in the same sentence that this does not
 * confer project content read. R4 A1's exemption is written about the administrator.
 *
 * So the two roles differ exactly here: compliance can see WHO READ WHAT, admin can also
 * see WHAT, at the price of appearing in the record themselves.
 */
const AUDIT_READERS: readonly OrgRole[] = ["admin"];

export function decideContentRead(input: ContentReadInput): ContentReadOutcome {
  const { item, requesterId, orgRole, purpose, baseDecision } = input;

  // Not a member: the tenant does not exist as far as this caller is concerned. Reported
  // as a denial with the org-layer code; mapping it to 404 is the interface layer's job.
  if (orgRole === null) return { kind: "deny", reasonCode: "NO_ORG_MEMBERSHIP" };

  // Checked after membership so that "no such item" cannot be used from outside the org to
  // probe for tenants -- a non-member gets the same answer whatever they ask for.
  if (item === null) return { kind: "not-found" };

  const isOwner = item.ownerUserId === requesterId;

  /* -- the personal layer ------------------------------------------------------------ */
  // Rule 2 of UC-0.3 R7, and the premise of the whole "my brain" layer: an admin sees the
  // COUNT and nothing else (`getPersonalLayerSummary`). There is exactly one route to
  // someone's private content and it is that person promoting it to the project layer.
  //
  // Note what is NOT consulted here: orgRole and purpose. An audit-purpose read by an
  // admin does not reach the personal layer -- if it did, the boundary would be a habit
  // rather than a rule, since anyone can type `purpose: "audit"`.
  if (item.layer === "personal") {
    return isOwner
      ? { kind: "allow", auditTrailRequired: false }
      : { kind: "deny", reasonCode: "PERSONAL_LAYER_CLOSED" };
  }

  /* -- drafts ------------------------------------------------------------------------ */
  // Before the audit exemption, on purpose. uc-0-1 R5 puts drafts alongside the personal
  // layer: creator only, "project admins and org admins included".
  if (item.status === "draft" && !isOwner) return { kind: "not-found" };

  /* -- the audit exemption (R4 A1) --------------------------------------------------- */
  // The org layer still applies. A team-only resource stays invisible to an admin outside
  // that team (AC3: "regardless of project role"), because the exemption A1 grants is from
  // the PROJECT layer -- "I have no role in this session" -- not from resource visibility.
  // Granting both would make `purpose: "audit"` a master key, which is the exact shape of
  // the thing D-18 forbids.
  if (purpose === "audit" && AUDIT_READERS.includes(orgRole)) {
    if (!baseDecision.scopeLayer.passed) {
      return { kind: "deny", reasonCode: "ORG_SCOPE_DENIED" };
    }
    // The trail is not optional and not best-effort: A1 permits the read BECAUSE it is
    // recorded. The caller must treat a failed write as a failed read.
    return { kind: "allow", auditTrailRequired: true };
  }

  /* -- everything else: the ordinary two-layer intersection -------------------------- */
  // Including an admin who asked for `purpose: "audit"` but is not an admin, and an admin
  // reading for ordinary work. AC1 lands here: the verdict is `decide()`'s, unmodified,
  // which is why being an admin changes nothing about it.
  if (baseDecision.allowed) return { kind: "allow", auditTrailRequired: false };
  return {
    kind: "deny",
    // `decide()` only returns a null reasonCode when it allowed, so this fallback is
    // unreachable -- present because a silently-undefined reason renders as a blank
    // permission screen, which is the least debuggable outcome available.
    reasonCode: baseDecision.reasonCode ?? "PROJECT_ROLE_INSUFFICIENT",
  };
}
