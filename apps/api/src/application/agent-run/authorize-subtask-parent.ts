import type { OrgId } from "../../domain/org-id";
import { AgentRunNotVisibleError, type ReadAgentRunDeps } from "./read-run";
import { AgentRunRetryForbiddenError } from "./retry-run";
import { resolveVisibility } from "../chat/resolve-visibility";

/** Subtasks inherit their parent's existing Chat visibility and write-role rules. */
export async function authorizeSubtaskParent(deps: ReadAgentRunDeps,
  input: { orgId: OrgId; userId: string; runId: string; write: boolean }): Promise<void> {
  const locator = await deps.runs.findLocator(input.orgId,input.runId);
  if (!locator) throw new AgentRunNotVisibleError();
  const outcome = await resolveVisibility(deps,{ userId: input.userId,orgId: input.orgId,
    projectId: locator.projectId,threadId: locator.threadId });
  if (outcome.kind !== "allow") throw new AgentRunNotVisibleError();
  if (input.write && (outcome.actor.projectRole === "observer" || outcome.thread.archived)) {
    throw new AgentRunRetryForbiddenError();
  }
}
