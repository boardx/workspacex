/**
 * `readAgentRun` -- the authorized read behind `GET /agent-runs/:runId` (delta §5).
 *
 * ## Why authorization goes through the CHAT decision and not a new one
 *
 * A run is not an independently visible object: it exists because somebody wrote a message
 * in a thread, and §9's matrix puts the run-status row's decision in the same column as
 * the thread it is embedded in. So this uses `resolveVisibility`, the single implementation
 * every Chat read path already goes through. Writing a second rule here is how two answers
 * to "may this person see this thread" come to exist, and nobody is told the day they
 * start disagreeing.
 *
 * ## Two calls, not one, and why that is not a hole
 *
 * `findLocator` runs BEFORE the decision, because the decision needs the run's thread and
 * project to even be asked -- gating it on the answer would be circular in exactly the way
 * `pg-identity-repository`'s allowlist entry describes. It returns ids and nothing else.
 * The run's content is fetched separately and comes back `Guarded`, so it can only be
 * unwrapped by handing over the decision that was just made.
 */
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import type { AgentRunStore, RunProjection } from "./ports";

/**
 * One exit for "no such run", "not your tenant" and "not your thread".
 *
 * Chat's I-3 rule applies here too: a distinguishable refusal turns this endpoint into an
 * oracle that confirms which run ids exist. The interface layer maps this to 404.
 */
export class AgentRunNotVisibleError extends Error {}

export interface ReadAgentRunDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
}

export async function readAgentRun(
  deps: ReadAgentRunDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly runId: string },
): Promise<RunProjection> {
  const locator = await deps.runs.findLocator(input.orgId, input.runId);
  if (locator === null) throw new AgentRunNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: locator.projectId,
    threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new AgentRunNotVisibleError();

  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (guarded === null) throw new AgentRunNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();
  return disclosed.payload;
}
