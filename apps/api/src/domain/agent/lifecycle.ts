/**
 * F55 -- the publish state machine (O-22④), the empty-whitelist publication gate (I-28),
 * and what 已停用 actually removes an agent from (I-32).
 *
 * ## Why the transition table is a `Record` over the contract enum
 *
 * `AgentPublishState` is a CLOSED enum. A lookup with a `default:` branch would give a state
 * nobody thought about some behaviour; a `Record<AgentPublishStateName, …>` gives it a
 * compile error. 已归档 is deliberately absent -- domain.md files it as a terminal subclass
 * of 已停用 and explicitly does NOT list it as a fifth state.
 *
 * ## Why 已停用 has an outgoing edge of `[]` and that is asserted
 *
 * 已停用 is terminal. Stating it as an empty array (rather than omitting the key) is what
 * makes "no reinstatement path exists" a fact the table can be QUERIED for, instead of an
 * absence nobody checks. Same reasoning as `AGENT_RUNTIME_FORBIDDEN_ROUTES` in the contract.
 */
import type { AgentDefinition, AgentPublishStateName } from "./definition";

/** Who may become whom. 已停用 is terminal (O-22④). */
export const PUBLISH_STATE_TRANSITIONS = {
  草稿: ["待审核"],
  /** [退回] goes back to 草稿; [批准发布] goes forward. */
  待审核: ["草稿", "运行中"],
  运行中: ["已停用"],
  已停用: [],
} as const satisfies Record<AgentPublishStateName, readonly AgentPublishStateName[]>;

export function canTransition(
  from: AgentPublishStateName,
  to: AgentPublishStateName,
): boolean {
  return (PUBLISH_STATE_TRANSITIONS[from] as readonly AgentPublishStateName[]).includes(to);
}

/**
 * I-28 / the [原型] hard gate, verbatim 「还没配工具白名单，不能发布」.
 *
 * Returns the contract's own error name so the interface layer transports it unchanged --
 * a domain module inventing a private reason string would make the API surface a second
 * declaration of the same failure.
 *
 * ⚠ Scope note: whether an individual entry is EFFECTIVE (I-29: both countersignatures
 * present) is F56's gate, not this one. I-28 is exactly "非空", and widening it here would
 * put the countersign rule in two places.
 */
export function checkWhitelistConfigured(
  agent: Pick<AgentDefinition, "toolWhitelist">,
): { ok: true } | { ok: false; reason: "TOOL_WHITELIST_EMPTY" } {
  return agent.toolWhitelist.length > 0
    ? { ok: true }
    : { ok: false, reason: "TOOL_WHITELIST_EMPTY" };
}

/**
 * The four surfaces an agent can appear on. Closed set: a fifth surface that forgets to ask
 * this function is how a disabled agent stays reachable, so the set is enumerated and the
 * per-surface answer is a total `Record`.
 *
 *   loadable-pool    可载入池 -- what `evaluateLoadRules` may pick from
 *   roster           编制面板 -- the orchestration panel
 *   private-chat     私聊入口
 *   agent-library    the /admin/agent list; a disabled agent is still ADMINISTRABLE
 */
export const AGENT_SURFACES = [
  "loadable-pool",
  "roster",
  "private-chat",
  "agent-library",
] as const;
export type AgentSurface = (typeof AGENT_SURFACES)[number];

/**
 * I-32, first half: 已停用 leaves the three runtime surfaces and stays on the admin one.
 *
 * `agent-library: true` is not a rounding error -- it is the reverse direction. An
 * implementation that hides a disabled agent everywhere also passes every "not in the pool"
 * assertion, and then nobody can audit or re-examine what was disabled.
 */
export function visibleOnSurface(
  agent: Pick<AgentDefinition, "publishState">,
  surface: AgentSurface,
): boolean {
  const byState: Record<AgentPublishStateName, Record<AgentSurface, boolean>> = {
    草稿: {
      "loadable-pool": false,
      roster: false,
      "private-chat": false,
      "agent-library": true,
    },
    待审核: {
      "loadable-pool": false,
      roster: false,
      "private-chat": false,
      "agent-library": true,
    },
    运行中: {
      "loadable-pool": true,
      roster: true,
      "private-chat": true,
      "agent-library": true,
    },
    已停用: {
      "loadable-pool": false,
      roster: false,
      "private-chat": false,
      "agent-library": true,
    },
  };
  return byState[agent.publishState][surface];
}

/** Convenience for the load-rule evaluator; identical fact, single source above. */
export function isLoadable(agent: Pick<AgentDefinition, "publishState">): boolean {
  return visibleOnSurface(agent, "loadable-pool");
}
