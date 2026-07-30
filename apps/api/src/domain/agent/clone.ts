/**
 * F55 / I-30 / O-22① -- 「复制一个现成的」copies the definition and **does not carry the tool
 * whitelist across**.
 *
 * ## Why this is a partition and not an `omit`
 *
 * `{ ...source, toolWhitelist: [] }` is one keystroke away from correct and silently wrong
 * the day someone adds a field: a spread inherits every future field by DEFAULT, and the
 * default direction here is "the clone gets more permission". So the fields are split into
 * two explicitly named lists, and the compile-time checks below refuse a `keyof
 * AgentDefinition` that appears in neither (a new field forces a decision) or in both.
 *
 * ## Why the whitelist is dropped rather than downgraded
 *
 * A cloned whitelist could plausibly be carried over as 越权申请待确认 "for re-approval".
 * O-22① says it is not carried at all, and the difference matters: a pending entry still
 * names the tools, so approving the batch is one click, which is how permission spreads
 * quietly. An empty whitelist forces the operator to re-derive the tool set from scratch,
 * and -- via I-28 -- blocks publication until they have.
 *
 * ⚠ This module deliberately contains **no scope ordering of its own**. Whether a given tool
 * may be whitelisted at all is decided by `checkToolScopeCap` / `checkToolScopeWithinServer`
 * and `TOOL_AUTH_SCOPE_RANK` in `@repo/contracts` (I-28′ / I-29′). A second ranking here
 * would be a sixth instance of "the same fact in two places" -- on a security boundary.
 */
import type { AgentDefinition, AgentVisibility } from "./definition";

/**
 * Fields a clone inherits from its source. This list is the POSITIVE half of I-30: without
 * it, an implementation that copies nothing at all also has an empty whitelist and passes.
 */
export const CLONE_INHERITED_FIELDS = [
  "orgId",
  "name",
  "initials",
  "role",
  "visibility",
  "source",
  "modelId",
  "skillMounts",
  "concurrencyLimit",
  "degradePolicy",
] as const satisfies readonly (keyof AgentDefinition)[];

/**
 * Fields a clone does NOT inherit.
 *
 *   agentId        a clone is a new record, not an alias
 *   cloneFrom      set to the SOURCE's id -- this is the audit trail F55 asks for
 *   publishState   always 草稿; a clone of a 运行中 agent is not itself 运行中
 *   toolWhitelist  always empty -- I-30, the reason this module exists
 */
export const CLONE_RESET_FIELDS = [
  "agentId",
  "cloneFrom",
  "publishState",
  "toolWhitelist",
] as const satisfies readonly (keyof AgentDefinition)[];

type InheritedKey = (typeof CLONE_INHERITED_FIELDS)[number];
type ResetKey = (typeof CLONE_RESET_FIELDS)[number];

/**
 * Compile-time totality: every field of `AgentDefinition` is classified exactly once.
 * A new field that is in neither list makes `_CloneKeysAreTotal` resolve to `never`, and
 * `const _: never = true` does not type-check. `pnpm --filter @repo/api run typecheck` is
 * the gate; a runtime test could not see a field nobody wrote code for.
 */
type _CloneKeysAreTotal =
  Exclude<keyof AgentDefinition, InheritedKey | ResetKey> extends never ? true : never;
type _CloneKeysAreDisjoint = Extract<InheritedKey, ResetKey> extends never ? true : never;
const _cloneKeysAreTotal: _CloneKeysAreTotal = true;
const _cloneKeysAreDisjoint: _CloneKeysAreDisjoint = true;
void _cloneKeysAreTotal;
void _cloneKeysAreDisjoint;

export interface NewAgentIdentity {
  readonly agentId: string;
  /** Optional overrides an operator types in the 复制 dialog; anything omitted is inherited. */
  readonly name?: string;
  readonly initials?: string;
  readonly role?: string;
  readonly visibility?: AgentVisibility;
}

/**
 * 复制一个现成的 -> a fresh 草稿 whose `cloneFrom` names the source and whose tool whitelist
 * is empty (I-30).
 *
 * Built field-by-field off `CLONE_INHERITED_FIELDS` rather than by spreading, so the lists
 * above are load-bearing at runtime and not just documentation.
 */
export function cloneAgentDefinition(
  source: AgentDefinition,
  identity: NewAgentIdentity,
): AgentDefinition {
  const inherited = Object.fromEntries(
    CLONE_INHERITED_FIELDS.map((key) => [key, source[key]]),
  ) as Pick<AgentDefinition, InheritedKey>;

  return {
    ...inherited,
    /**
     * Copied by value. `...inherited` hands over the SOURCE's array object, so a later
     * `push` on either side would be visible on the other -- and on the whitelist side that
     * is exactly the silent permission spread I-30 exists to prevent. (Caught by the
     * aliasing case in `clone-drops-whitelist.test.ts`, which failed on first run.)
     */
    skillMounts: inherited.skillMounts.map((m) => ({ ...m })),
    name: identity.name ?? inherited.name,
    initials: identity.initials ?? inherited.initials,
    role: identity.role ?? inherited.role,
    visibility: identity.visibility ?? inherited.visibility,
    agentId: identity.agentId,
    cloneFrom: source.agentId,
    publishState: "草稿",
    /** I-30. Not `source.toolWhitelist.map(...)`, not "pending re-approval" -- empty. */
    toolWhitelist: [],
  };
}

/** 从零新建 -- the other branch of `createAgent`, kept here so both share one code path. */
export function newAgentDefinition(
  base: Omit<AgentDefinition, "cloneFrom" | "publishState" | "toolWhitelist">,
): AgentDefinition {
  return { ...base, cloneFrom: null, publishState: "草稿", toolWhitelist: [] };
}
