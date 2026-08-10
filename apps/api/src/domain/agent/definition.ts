/**
 * F55 -- the `Agent` entity's vocabulary, inferred from the contract rather than restated.
 *
 * Every type here is a `z.infer` off `@repo/contracts` `agentRuntime`. None of the string
 * unions ("全组织可用" | "仅某组", the four publish states, the five whitelist states) is
 * spelled a second time in this package: this repo has drifted five times on "the same fact
 * declared in two places", and a domain module that re-types an enum is exactly that shape.
 * Adding a member to the contract enum must make code here a compile error, not a silent
 * unhandled case.
 *
 * Pure: no clock, no I/O, no storage. Everything in `domain/agent/*` is a total function of
 * its arguments, which is what lets F55's three invariants be asserted without Postgres.
 */
import { agentRuntime as A } from "@repo/contracts";
import type { z } from "zod";

export type AgentPublishStateName = z.infer<typeof A.AgentPublishState>;
/** ⚠ Two values, and they are an INDEPENDENT field from skill/MCP scoping -- never merged. */
export type AgentVisibility = z.infer<typeof A.AgentRow>["visibility"];
export type ToolWhitelistEntryT = z.infer<typeof A.ToolWhitelistEntry>;
export type SkillMountT = z.infer<typeof A.SkillMount>;
export type DegradePolicyName = z.infer<typeof A.DegradePolicy>;
export type AgentSource = z.infer<typeof A.operations.createAgent.in>["source"];

/**
 * The mutable "current definition" of an agent (domain.md §C `Agent`).
 *
 * `toolWhitelist` lives ON the definition and not beside it because I-28 ("运行中 ⇒ 白名单
 * 非空") and I-30 ("cloneFrom != null ⇒ 白名单恒空") are both statements about this one
 * record. Keeping the whitelist in a separate structure would let a clone be constructed
 * that satisfies I-30 by never having been given a whitelist to drop.
 */
export interface AgentDefinition {
  readonly agentId: string;
  readonly orgId: string;
  readonly name: string;
  /** AV / SC / EC / LG / DV / JT -- the initials badge. */
  readonly initials: string;
  /** 职责一句话. */
  readonly role: string;
  /**
   * #660 候选 A —— 用户自己写的**可执行定义**（系统提示词），`null` = 尚未配置。
   *
   * ⚠ 与上面的 `role` **不是同一件事，不得互相顶替**：`role` 是给人看的角色标签，
   *   `instructions` 是运行时真的照着执行的那段文本。
   *   `design-deltas/agent-instructions/design-signoff.md` 逐字禁止用 `role` 硬凑它。
   * ⚠ 它是 `agent_versions.instructions`（NOT NULL）的唯一来源：为 `null` 时
   *   agent 铸不出可执行版本，发布被 `AGENT_NO_EXECUTABLE_DEFINITION` 拒。
   */
  readonly instructions: string | null;
  readonly visibility: AgentVisibility;
  /** null = built from scratch; non-null = 复制一个现成的 (I-30). */
  readonly cloneFrom: string | null;
  readonly source: AgentSource;
  readonly publishState: AgentPublishStateName;
  /** Single model, never an array (I-3). null while still 草稿. */
  readonly modelId: string | null;
  /** Version-grained, always (X-10). A mount without `skillVersion` is not a mount. */
  readonly skillMounts: readonly SkillMountT[];
  readonly toolWhitelist: readonly ToolWhitelistEntryT[];
  readonly concurrencyLimit: number;
  readonly degradePolicy: DegradePolicyName;
}

/**
 * Runtime proof that a `SkillMount` carries a version.
 *
 * The TYPE already requires it, but the type is erased: a mount arriving from a repository
 * row or a JSON body is `any` at the boundary, and "挂载 skill 时记录 skill 版本快照"
 * (F55 user_visible_behavior) is precisely the field such a row loses. Parsing through the
 * contract schema is the only check that survives erasure.
 */
export function parseSkillMount(candidate: unknown): SkillMountT {
  return A.SkillMount.parse(candidate);
}
