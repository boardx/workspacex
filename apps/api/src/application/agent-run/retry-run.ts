/**
 * `retryAgentRun` -- reopening a run whose Chat writeback budget was exhausted (#519, §6).
 *
 * 🟡 **该契约面（`wave2Runtime.operations.retryAgentRun`）待人类补签**，照 #496
 * `createTemplate` 先例。补签时必须一并裁的三件逐字写在契约里该操作的文件头上，其中一件是
 * **§6 的措辞「新 run」要改**：本文件重置既有 run，不新建。
 *
 * ## Retry is a WRITE in the thread, so it is authorized like one
 *
 * Reading a run goes through `readAgentRun`, whose whole argument is that a run is not an
 * independently visible object -- it is visible exactly when its thread is. Reopening one is
 * not a read: it puts an assistant message into that thread on the next tick. So this reuses
 * the same visibility decision AND the two extra conditions `acceptHumanMessage` applies to
 * writing in a thread (not an observer, thread not archived). Inventing a third rule here is
 * how two answers to "may this person write in this thread" come to exist.
 *
 * ## Why the state check is not made here
 *
 * "Is this run retryable?" answered in this file and acted on in a later statement is a race
 * whose loser reopens a run that has since succeeded. `reopenForWritebackRetry` is one
 * statement carrying its own predicate, and the database's transition trigger refuses the
 * move independently. This file only translates `false` into a refusal.
 */
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import { AgentRunNotVisibleError } from "./read-run";
import type { AgentRunStore, RunProjection } from "./ports";

/** Visible, but this person may not write in the thread (observer, or archived). */
export class AgentRunRetryForbiddenError extends Error {}

/** Not a run whose Chat writeback ran out of budget, so there is nothing to reopen. */
export class AgentRunNotRetryableError extends Error {}

export interface RetryAgentRunDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
}

export async function retryAgentRun(
  deps: RetryAgentRunDeps,
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
  if (outcome.actor.projectRole === "observer") throw new AgentRunRetryForbiddenError();
  if (outcome.thread.archived) throw new AgentRunRetryForbiddenError();

  const reopened = await deps.runs.reopenForWritebackRetry(input.orgId, input.runId);
  if (!reopened) throw new AgentRunNotRetryableError();

  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (guarded === null) throw new AgentRunNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();
  return disclosed.payload;
}
