import type { OrgId } from "../../domain/org-id";
import { resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { AgentRunStore, ModelCallPort } from "./ports";
import { AgentRunNotVisibleError } from "./read-run";
import { AgentRunRetryForbiddenError } from "./retry-run";

export class RunCancellationUnavailableError extends Error {}
export class RunCancellationConflictError extends Error {}
export async function cancelAgentRun(
  deps: ResolveVisibilityDeps & { runs: AgentRunStore; model?: ModelCallPort; liveQueue: boolean },
  input: { orgId: OrgId; userId: string; runId: string },
) {
  const locator = await deps.runs.findLocator(input.orgId, input.runId);
  if (!locator) throw new AgentRunNotVisibleError();
  const access = await resolveVisibility(deps, { ...input, projectId: locator.projectId, threadId: locator.threadId });
  if (access.kind !== "allow") throw new AgentRunNotVisibleError();
  if (access.actor.projectRole === "observer" || access.thread.archived) throw new AgentRunRetryForbiddenError();
  if (await deps.runs.findRequesterUserId?.(input.orgId, input.runId) !== input.userId) throw new AgentRunNotVisibleError();
  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (!guarded) throw new AgentRunNotVisibleError();
  const disclosed = discloseDecided(guarded, access.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();
  if (disclosed.payload.status === "running" && (!deps.liveQueue || !deps.model?.supportsLiveInterjections?.(disclosed.payload.modelProvider))) {
    throw new RunCancellationUnavailableError();
  }
  if (!deps.runs.requestCancellation) throw new RunCancellationUnavailableError();
  const status = await deps.runs.requestCancellation(input.orgId, input.runId);
  if (!status) throw new RunCancellationConflictError();
  return { runId: input.runId, status };
}
