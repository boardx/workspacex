/**
 * `GetPersonalLayerSummary` -- what an administrator is allowed to know about someone
 * else's personal layer: how many items there are. Nothing else.
 *
 * ## Invariant I-8, and why the wording of it matters
 *
 * "The response body contains NO content field" -- not "the content field is empty".
 * Those are different failures and only one of them stays fixed. An empty string is a
 * value somebody fills in later ("the UI needs a preview", "just the title, surely"), and
 * every step of that is a small, reasonable-looking change. A missing key cannot be filled
 * in without changing the contract, which is a review.
 *
 * So this function builds the response out of literals. It never spreads a row, never
 * `{...item}`, never maps a record -- because all three of those return whatever the
 * storage layer happened to select, and the day someone adds a column to that SELECT the
 * response grows a field nobody decided to publish.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { ContentRepository } from "./content-ports";
import type { IdentityRepository } from "./ports";
import { NoOrgMembershipError } from "./switch-organization";

/** Derived from the contract, never restated. */
export type PersonalLayerSummary = z.infer<typeof identity.operations.getPersonalLayerSummary.out>;

export interface PersonalLayerDeps {
  readonly repo: IdentityRepository;
  readonly content: ContentRepository;
}

export interface PersonalLayerInput {
  /** Who is asking */
  readonly requesterId: string;
  readonly orgId: OrgId;
  /** Whose personal layer is being counted */
  readonly userId: string;
}

export async function getPersonalLayerSummary(
  deps: PersonalLayerDeps,
  input: PersonalLayerInput,
): Promise<PersonalLayerSummary> {
  const { repo, content } = deps;
  const { requesterId, orgId, userId } = input;

  // The counts are org data, so org membership is required to see them at all. Note that
  // no ORG ROLE is checked: counts are equally visible to an admin and to a consultant,
  // because the boundary being enforced is about CONTENT, and pretending counts are
  // privileged would suggest that something more privileged exists behind them.
  const membership = await repo.findOrgMembership(requesterId, orgId);
  if (membership === null) throw new NoOrgMembershipError();

  const itemCount = await content.countPersonalItems(orgId, userId);

  return {
    userId,
    itemCount,
    // Stated rather than implied. A bare number with no explanation reads as a loading
    // failure; UC-0.3 R8 asks for the reason, not just the refusal.
    reasonCode: userId === requesterId ? null : "PERSONAL_LAYER_CLOSED",
  };
}
