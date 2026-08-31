/**
 * D-39 硬约束（uc-11-1 R7/AC4）：`owner` 恒为人；agent 只能出现在 `executor` 字段。
 *
 * `tasks.executor` (F01 migration comment) already established the convention that an
 * agent identity is a free-text string prefixed `agent:` (e.g. `agent:scout`). This file
 * is the ONE place that convention is checked against, so `create-task.ts` and any future
 * "reassign owner" use case share the same rule instead of each re-deciding what "looks
 * like an agent id" means.
 *
 * A literal-prefix check is deliberately weak (it cannot know about an identity table it
 * has no port to) -- the DB-side mirror (`tasks_owner_not_agent_literal_check` in the F02
 * migration) is exactly as weak, for the same reason: this is a fail-fast guard against
 * the obvious mistake, not a substitute for an identity lookup a full agent-runtime
 * integration would eventually add.
 */
export const AGENT_IDENTITY_PREFIX = "agent:";

export function isAgentIdentifier(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(AGENT_IDENTITY_PREFIX);
}

export class OwnerMustBeHumanError extends Error {
  readonly code = "OWNER_MUST_BE_HUMAN";
  constructor(readonly attemptedOwnerId: string) {
    super("OWNER_MUST_BE_HUMAN");
  }
}

/** Throws `OwnerMustBeHumanError` when `ownerId` looks like an agent identity. */
export function assertHumanOwner(ownerId: string): void {
  if (isAgentIdentifier(ownerId)) throw new OwnerMustBeHumanError(ownerId);
}
