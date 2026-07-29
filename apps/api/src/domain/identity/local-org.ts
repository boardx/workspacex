/**
 * The personal-local organization's rules (F16 / uc-0-5 R7, domain I-2 / I-3 / I-9 / I-10).
 *
 * Pure. No HTTP, no SQL, no sockets. Everything here is DERIVED from
 * `packages/contracts/src/identity.ts` -- including the string `"personal-local"` itself,
 * which does not appear in this file. That is the point of the file existing at all: before
 * F16 the same judgement was written out three times (this layer, the web shell, the model
 * constraint rule), and the fact those three encode is the one whose drift means data leaves
 * a machine it was promised not to leave.
 *
 * ## What is a rule here and what is NOT
 *
 * Here: what counts as local, which key prefix local bytes live under, what to tell a user
 * about a row that had to be greyed out.
 *
 * Not here: the enforcement. A pure function cannot stop a socket from opening. Enforcement
 * is in three other places, and each is a layer no caller can route around:
 *   * the database (migration 0012's triggers)
 *   * the process-level egress guard (`infrastructure/egress/local-egress-guard.ts`)
 *   * the use case that refuses rather than falls back (`invoke-local-model.ts`)
 * Saying so explicitly because a reader who found the rules here could reasonably assume
 * this file is the guarantee, and then stop looking for the parts that actually hold.
 */
import { identity as C } from "@repo/contracts";
import type { z } from "zod";

export type OrgKind = z.infer<typeof C.OrgKind>;
export type CapabilityListing = z.infer<typeof C.CapabilityListing>;

/**
 * The kind's value, re-exported so even SQL parameters bind it rather than spelling it out.
 * `local-org-invisible-to-admin.test.ts` fails the build if the literal appears anywhere under
 * `src/` outside a comment.
 */
export const LOCAL_ORG_KIND = C.LOCAL_ORG_KIND;

/** The one judgement. Everything else in the backend asks this, nothing compares strings. */
export function isLocalOrg(kind: OrgKind | string | null | undefined): boolean {
  return C.isLocalOrgKind(kind ?? null);
}

/** Re-exported, not restated -- the guarantees are contract text (F16 report surface). */
export const LOCAL_ORG_GUARANTEES = C.LOCAL_ORG_GUARANTEES;

/** `local/<orgId>/` -- the addressable set of bytes that may not leave the machine. */
export function localObjectKeyPrefix(orgId: string): string {
  return C.localObjectKeyPrefix(orgId);
}

/**
 * Is this endpoint on this machine?
 *
 * Loopback and unix sockets only; a LAN address is NOT local. See the contract for why the
 * narrow reading is the right one: the promise says "does not leave this machine", and a
 * self-hosted model on the box next door has already left it.
 */
export function isLocalEndpoint(endpoint: string | null | undefined): boolean {
  return C.isLocalModelEndpoint(endpoint);
}

/**
 * What a local organization's view of a capability looks like.
 *
 * ⚠ `enabled: false` here is DERIVED, and it does not touch the stored row. An organization
 * whose admin later leaves the local organization -- which cannot happen, but the code should
 * not depend on that -- would see the stored value again. Writing the derived value back
 * would create a second fact: the database would say "disabled" for a reason the rule no
 * longer gives, and nothing would reconcile them.
 *
 * ⚠ The row is RETURNED, not filtered out (uc-0-5 R8). Hiding a cloud model reads as "this
 * product has no cloud models"; greying it out with a reason says "this organization does not
 * allow them", which is the true and actionable statement.
 */
export function projectListingForOrg(
  listing: CapabilityListing,
  orgKind: OrgKind | string,
): CapabilityListing {
  if (!isLocalOrg(orgKind)) {
    return {
      ...listing,
      disabledReason: listing.enabled ? null : "该条目已被组织管理员停用。",
    };
  }

  // Only endpoint-bearing kinds can be "cloud". A skill has nowhere to run remotely from,
  // so calling it cloud would be a category error dressed as a security decision.
  const remote = listing.endpoint !== null && !isLocalEndpoint(listing.endpoint);
  if (remote) {
    return {
      ...listing,
      enabled: false,
      disabledReason: C.localOrgCloudDisabledReason(listing.endpoint),
    };
  }
  return {
    ...listing,
    disabledReason: listing.enabled ? null : "该条目已被停用。",
  };
}

/** The startup guidance the UI shows when the local runtime is down. Single source. */
export const LOCAL_RUNTIME_STARTUP_HINT = C.LOCAL_RUNTIME_STARTUP_HINT;
