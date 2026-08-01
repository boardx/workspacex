/**
 * `setToolAuthScope` (F130, UC-21.1 R7) -- I-28′ enforced ON THE WRITE PATH.
 *
 * ## Why this file has to exist, not just the pure function
 *
 * `checkToolScopeCap` in `@repo/contracts/agent-runtime` already computes the right answer.
 * Having the right pure function is not the same as the write path calling it -- a UI that
 * greys out the "全体成员" option is not enforcement, it is decoration: a client that skips
 * the UI and calls the API directly sails straight through. This file is the one place a
 * caller of `setToolAuthScope` cannot get around: the cap check runs here, before the store
 * is touched, and a rejection here means nothing was written.
 *
 * ⚠ **What this file deliberately does NOT do**: check `checkToolScopeWithinServer` (I-29′,
 * the server-level upper bound). That gate needs a persisted server-level `authScope` to
 * compare against, and no store for that exists yet anywhere in this codebase (`setAuthScope`,
 * the server-level write endpoint, has no application-layer implementation to depend on --
 * `grep -rn setAuthScope apps/api/src` turns up only the contract). Wiring I-29′ in here
 * against a store that does not exist would mean inventing that store's shape as a side
 * effect of F130, which is F53/F129's call to make, not this feature's. `checkToolScopeCap`
 * (I-28′) is the gate F130 owns; it is the only one enforced here.
 */
import {
  checkToolScopeCap,
  type ToolAuthScopeT,
} from "@repo/contracts/agent-runtime";
import {
  McpToolNotFoundError,
  ToolScopeExceedsSideEffectCapError,
  type ToolAuthScopeStore,
} from "./ports";

export interface SetToolAuthScopeDeps {
  readonly store: ToolAuthScopeStore;
}

export interface SetToolAuthScopeInput {
  readonly toolFullName: string;
  readonly authScope: ToolAuthScopeT;
}

/**
 * Returns the tool with its new `authScope`, or throws:
 * - `McpToolNotFoundError` -- no tool recorded under this full name.
 * - `ToolScopeExceedsSideEffectCapError` -- I-28′: the requested scope outranks what this
 *   tool's `sideEffect` allows. **Nothing is written** when this throws.
 */
export async function setToolAuthScope(
  deps: SetToolAuthScopeDeps,
  input: SetToolAuthScopeInput,
) {
  const tool = await deps.store.findByFullName(input.toolFullName);
  if (tool === null) throw new McpToolNotFoundError(input.toolFullName);

  const check = checkToolScopeCap({ sideEffect: tool.sideEffect, authScope: input.authScope });
  if (!check.ok) {
    throw new ToolScopeExceedsSideEffectCapError(
      input.toolFullName,
      check.maxAllowedRank,
      check.requestedRank,
    );
  }

  await deps.store.updateAuthScope(input.toolFullName, input.authScope);
  return { ...tool, authScope: input.authScope };
}
