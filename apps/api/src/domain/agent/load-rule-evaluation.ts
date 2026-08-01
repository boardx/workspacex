/**
 * F57 -- UC-4.2 阶段三：状态事件 → 载入求值（`evaluateLoadRules`）+ 线程级 AI 团队投影
 * （`getThreadAiTeam` / `composeThreadTeam`）的纯函数核心。
 *
 * `user_visible_behavior`: 「现场切议程环节/某组停滞/投票进行中时按载入规则重新求值，命中多条时
 * 按优先级取前 4 个、被裁剪的可查；…每次载入/换出可点开看"因什么载入"（触发事件 + 命中规则）；
 * 跑批中的 agent 在切环节时不被强杀…同一状态事件重复投递不重复载入、计数不翻倍。」
 *
 * ## Why this is a pure function over a caller-supplied idempotency ledger, not a repository call
 *
 * I-35 ("同一事件重复投递不重复载入、计数不翻倍") is an idempotency guarantee. The natural
 * place to enforce it in production is a DB unique constraint on `idempotencyKey`, but that
 * is I/O this bundle does not own (see F56's `three-layer-permission.ts` for the same
 * argument). What CAN be asserted without Postgres is: given a ledger of previously-applied
 * keys and their results, replaying the same key returns the SAME result and does not mutate
 * the ledger a second time. The caller (application layer) is responsible for persisting the
 * ledger; this module is responsible for the replay semantics being correct.
 *
 * ## Why "skip not-running" happens BEFORE the top-4 cut, and does not backfill
 *
 * E2 says a rule whose agent is not `运行中` is skipped "and this is NOT silently downgraded
 * to a different agent". If the not-running filter ran AFTER the top-4 cut, a rule ranked
 * 5th could take the freed slot of a skipped 2nd-ranked rule -- which IS a silent substitution,
 * just a delayed one. Filtering not-running matches out first, then cutting the top 4 of what
 * remains, is the only order under which "skipped" and "pruned by priority" stay two distinct,
 * non-overlapping reasons a rule didn't load.
 *
 * ## Why 跑批中 agents are carried over independent of whether they re-match (E4)
 *
 * The roster projection does not derive itself purely from "this evaluation's matches" --
 * an agent already in the incoming roster with `presence: "跑批中"` is preserved even if no
 * rule in THIS evaluation names it, because E4 is explicit that a segment switch must not
 * force-kill a running background task. It is dropped from the roster only once its own
 * caller-side completion event removes it (out of this module's scope -- this module only
 * promises not to be the thing that evicts it).
 */
import { agentRuntime as A } from "@repo/contracts";
import type { z } from "zod";
import { isLoadable } from "./lifecycle";
import type { AgentPublishStateName } from "./definition";

type LoadRuleTriggerEventT = z.infer<typeof A.LoadRuleTriggerEvent>;
export type AgentPresenceT = z.infer<typeof A.AgentPresence>;
type PresenceState = AgentPresenceT["presence"];

/** 一条载入规则（蓝本/项目实例级配置的投影，本模块只读它，不管它从哪来）. */
export interface LoadRule {
  readonly ruleId: string;
  readonly triggerEvent: LoadRuleTriggerEventT;
  readonly agendaSegmentId: string;
  /** 数值越小优先级越高（1 = 最高）。 */
  readonly priority: number;
  readonly agentId: string;
}

/** 规则引用的 agent，评估载入时只关心它是否 `运行中`（I-52 的可见性范围由上游过滤，不复算于此）. */
export interface LoadableAgentFact {
  readonly agentId: string;
  readonly name: string;
  readonly agentVersionId: string;
  readonly publishState: AgentPublishStateName;
}

export const MAX_LOADED_BY_PRIORITY = 4;

export interface EvaluateLoadRulesInput {
  readonly event: LoadRuleTriggerEventT;
  readonly agendaSegmentId: string;
  readonly idempotencyKey: string;
  readonly rules: readonly LoadRule[];
  readonly agents: ReadonlyMap<string, LoadableAgentFact>;
  /** 求值前线程已有的团队投影（用于 E4 的“跑批中”留任）。 */
  readonly currentRoster: readonly AgentPresenceT[];
}

export interface LoadedBecauseEntry {
  readonly agentId: string;
  readonly triggerEvent: LoadRuleTriggerEventT;
  readonly matchedRuleId: string;
}

export interface PrunedEntry {
  readonly agentId: string;
  readonly ruleId: string;
}

export interface LoadRuleEvaluationResult {
  readonly roster: readonly AgentPresenceT[];
  readonly loadedBecause: readonly LoadedBecauseEntry[];
  readonly prunedByPriority: readonly PrunedEntry[];
  readonly nextSegmentPreview: readonly string[];
  readonly skippedNotRunning: readonly string[];
}

/**
 * The core matcher: filter rules for this (event, agendaSegmentId), drop not-running agents
 * (E2), then keep only the top `MAX_LOADED_BY_PRIORITY` by priority among what remains (E1 /
 * I-37). Pure -- no ledger, no idempotency; that is layered on top by `evaluateLoadRules`.
 */
function matchAndPrioritize(
  input: Pick<EvaluateLoadRulesInput, "event" | "agendaSegmentId" | "rules" | "agents">,
): {
  loaded: readonly { rule: LoadRule; agent: LoadableAgentFact }[];
  prunedByPriority: readonly PrunedEntry[];
  skippedNotRunning: readonly string[];
} {
  const matched = input.rules.filter(
    (r) => r.triggerEvent === input.event && r.agendaSegmentId === input.agendaSegmentId,
  );

  const skippedNotRunning: string[] = [];
  const runnable: { rule: LoadRule; agent: LoadableAgentFact }[] = [];
  for (const rule of matched) {
    const agent = input.agents.get(rule.agentId);
    // Not found, or found but not 运行中 -- both are "not currently loadable", and both are
    // skipped rather than silently substituted (E2).
    if (agent === undefined || !isLoadable(agent)) {
      skippedNotRunning.push(rule.agentId);
      continue;
    }
    runnable.push({ rule, agent });
  }

  // Stable sort by priority ascending (lower = higher priority). `Array.prototype.sort` in
  // Node is stable, so rules of equal priority keep their input (rule-table) order rather
  // than being reshuffled -- required for the "same event replayed" idempotency check to be
  // meaningful (a non-stable sort could produce a DIFFERENT top-4 set on a second run over
  // the identical input, which would look like non-idempotence that isn't really there).
  const sorted = [...runnable].sort((a, b) => a.rule.priority - b.rule.priority);
  const loaded = sorted.slice(0, MAX_LOADED_BY_PRIORITY);
  const prunedByPriority: PrunedEntry[] = sorted
    .slice(MAX_LOADED_BY_PRIORITY)
    .map(({ rule }) => ({ agentId: rule.agentId, ruleId: rule.ruleId }));

  return { loaded, prunedByPriority, skippedNotRunning };
}

/** 把「本轮求值命中的 agent」与「上一轮留任的跑批中 agent」投影为新的线程团队（E4）. */
function projectRoster(
  loaded: readonly { rule: LoadRule; agent: LoadableAgentFact }[],
  currentRoster: readonly AgentPresenceT[],
): readonly AgentPresenceT[] {
  const loadedIds = new Set(loaded.map(({ agent }) => agent.agentId));

  const freshlyPresent: AgentPresenceT[] = loaded.map(({ agent }) => ({
    agentId: agent.agentId,
    name: agent.name,
    presence: "在场" as PresenceState,
    agentVersionId: agent.agentVersionId,
  }));

  // E4: an agent mid-batch-job is carried over untouched even if this evaluation no longer
  // names it -- switching segments must not force-kill it. If it WAS re-matched this round,
  // the fresh "在场" entry above wins instead (its batch presumably finished, or the rule
  // simply reconfirms it) -- `loadedIds` is exactly the de-dup key for that.
  const carriedOverRunning = currentRoster.filter(
    (entry) => entry.presence === "跑批中" && !loadedIds.has(entry.agentId),
  );

  return [...freshlyPresent, ...carriedOverRunning];
}

/**
 * The core evaluation, WITHOUT idempotency replay. Exposed for callers (and tests) that
 * already have a de-duplicated event stream and only need the matching/priority/roster
 * semantics.
 */
export function evaluateLoadRulesOnce(
  input: EvaluateLoadRulesInput,
): LoadRuleEvaluationResult {
  const { loaded, prunedByPriority, skippedNotRunning } = matchAndPrioritize(input);
  const roster = projectRoster(loaded, input.currentRoster);
  const loadedBecause: LoadedBecauseEntry[] = loaded.map(({ rule, agent }) => ({
    agentId: agent.agentId,
    triggerEvent: rule.triggerEvent,
    matchedRuleId: rule.ruleId,
  }));

  return {
    roster,
    loadedBecause,
    prunedByPriority,
    // [Backlog] 下一议程环节提前提示：原型 0 命中，本束未建下一环节规则表，恒空而非猜测。
    nextSegmentPreview: [],
    skippedNotRunning,
  };
}

/** 一次已应用求值的留痕，供幂等重放比对（I-35）. */
export interface LoadRuleLedgerEntry {
  readonly idempotencyKey: string;
  readonly result: LoadRuleEvaluationResult;
}

export interface EvaluateLoadRulesOutcome {
  readonly result: LoadRuleEvaluationResult;
  readonly ledger: readonly LoadRuleLedgerEntry[];
  /** true = 本次是对已处理过的 idempotencyKey 的重放，未重新求值、未追加新账本项. */
  readonly replayed: boolean;
}

/**
 * I-35 的幂等入口：`idempotencyKey` 已在账本里 ⇒ 原样返回上次的结果，账本不追加第二条
 * （「同一状态事件重复投递不重复载入、计数不翻倍」的字面意思就是「返回同一个结果」，不是
 * 「返回一个等价但重新计算的结果」——两次独立计算即使数字凑巧相同也不构成「同一次」）。
 */
export function evaluateLoadRules(
  input: EvaluateLoadRulesInput,
  ledger: readonly LoadRuleLedgerEntry[],
): EvaluateLoadRulesOutcome {
  const existing = ledger.find((e) => e.idempotencyKey === input.idempotencyKey);
  if (existing !== undefined) {
    return { result: existing.result, ledger, replayed: true };
  }

  const result = evaluateLoadRulesOnce(input);
  const nextLedger = [...ledger, { idempotencyKey: input.idempotencyKey, result }];
  return { result, ledger: nextLedger, replayed: false };
}

/* ══════════════════════ 编制数 ≠ 在场数（两口径，I-34）══════════════════════ */

export interface ThreadAiTeamProjection {
  readonly roster: readonly AgentPresenceT[];
  readonly rosterCount: number;
  readonly presentCount: number;
}

/**
 * 侧栏「编制数」= 团队里全部条目（含跑批中/依赖失败/静音）；
 * 线程头部「在场数」= 仅 `presence === "在场"` 的条目。
 * ⚠ 两者是同一个 roster 的两种计数投影，不是两个独立数据源——避免出现「侧栏与头部各自
 * 有一份团队清单，可能不同步」的第二份事实（AGENTS.md 的单一事实源纪律）。
 */
export function projectThreadAiTeam(
  roster: readonly AgentPresenceT[],
): ThreadAiTeamProjection {
  return {
    roster,
    rosterCount: roster.length,
    presentCount: roster.filter((entry) => entry.presence === "在场").length,
  };
}
