/**
 * F57 -- 「因什么载入」可解释：每个被载入的 agent 都能追溯到触发事件 + 命中的规则 id,
 * 且这份解释与账本重放（幂等）后仍然保持一致。
 *
 * `user_visible_behavior`: 「每次载入/换出可点开看"因什么载入"（触发事件 + 命中规则）」。
 * AC1（R6）：「主持台能看到当前载入了谁、为什么、下一步会换成谁」。
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import {
  evaluateLoadRules,
  evaluateLoadRulesOnce,
  type EvaluateLoadRulesInput,
  type LoadableAgentFact,
  type LoadRule,
} from "../../../src/domain/agent/load-rule-evaluation";

function agentFact(over: Partial<LoadableAgentFact> = {}): LoadableAgentFact {
  return { agentId: "agt-1", name: "Ava", agentVersionId: "av-1", publishState: "运行中", ...over };
}

function rule(over: Partial<LoadRule> = {}): LoadRule {
  return {
    ruleId: "rule-scout-briefing",
    triggerEvent: "agenda_segment.switched",
    agendaSegmentId: "seg-briefing",
    priority: 1,
    agentId: "agt-scout",
    ...over,
  };
}

function baseInput(over: Partial<EvaluateLoadRulesInput> = {}): EvaluateLoadRulesInput {
  return {
    event: "agenda_segment.switched",
    agendaSegmentId: "seg-briefing",
    idempotencyKey: "evt-briefing-1",
    rules: [rule()],
    agents: new Map([["agt-scout", agentFact({ agentId: "agt-scout", name: "Scout" })]]),
    currentRoster: [],
    ...over,
  };
}

describe("F57 -- 每个载入的 agent 都能查到「因什么载入」：触发事件 + 命中规则", () => {
  it("loadedBecause 逐条写明 agentId / triggerEvent / matchedRuleId，三者缺一不可", () => {
    const result = evaluateLoadRulesOnce(baseInput());
    expect(result.loadedBecause).toEqual([
      { agentId: "agt-scout", triggerEvent: "agenda_segment.switched", matchedRuleId: "rule-scout-briefing" },
    ]);
  });

  it("换一个触发事件（某组停滞对应的 state_changed）载入的原因也随之不同——不是写死的常量", () => {
    const result = evaluateLoadRulesOnce(
      baseInput({
        event: "agenda_segment.state_changed",
        rules: [rule({ triggerEvent: "agenda_segment.state_changed", ruleId: "rule-stall-warden" , agentId: "agt-warden" })],
        agents: new Map([["agt-warden", agentFact({ agentId: "agt-warden", name: "Warden" })]]),
      }),
    );
    expect(result.loadedBecause).toEqual([
      { agentId: "agt-warden", triggerEvent: "agenda_segment.state_changed", matchedRuleId: "rule-stall-warden" },
    ]);
  });

  it("同一 agent 被两条不同规则各自命中时（不同环节的两次求值），两次的 matchedRuleId 不同——可区分是哪一条规则起效", () => {
    const first = evaluateLoadRulesOnce(baseInput());
    const second = evaluateLoadRulesOnce(
      baseInput({
        agendaSegmentId: "seg-followup",
        event: "agenda_segment.switched",
        rules: [rule({ ruleId: "rule-scout-followup", agendaSegmentId: "seg-followup" })],
      }),
    );
    expect(first.loadedBecause[0]?.matchedRuleId).toBe("rule-scout-briefing");
    expect(second.loadedBecause[0]?.matchedRuleId).toBe("rule-scout-followup");
    expect(first.loadedBecause[0]?.matchedRuleId).not.toBe(second.loadedBecause[0]?.matchedRuleId);
  });

  it("被优先级裁剪掉的 agent 不出现在 loadedBecause 里（它没有被载入，自然没有「因什么载入」）", () => {
    const agents = new Map([
      ["agt-1", agentFact({ agentId: "agt-1", name: "A1" })],
      ["agt-2", agentFact({ agentId: "agt-2", name: "A2" })],
      ["agt-3", agentFact({ agentId: "agt-3", name: "A3" })],
      ["agt-4", agentFact({ agentId: "agt-4", name: "A4" })],
      ["agt-5", agentFact({ agentId: "agt-5", name: "A5" })],
    ]);
    const rules = [1, 2, 3, 4, 5].map((n) =>
      rule({ ruleId: `r-${n}`, agentId: `agt-${n}`, priority: n }),
    );
    const result = evaluateLoadRulesOnce(baseInput({ rules, agents }));
    expect(result.loadedBecause.some((e) => e.agentId === "agt-5")).toBe(false);
    expect(result.prunedByPriority).toEqual([{ agentId: "agt-5", ruleId: "r-5" }]);
  });

  it("幂等重放后「因什么载入」的解释与首次求值完全一致——不是重放丢失了原因字段", () => {
    const input = baseInput();
    const first = evaluateLoadRules(input, []);
    const replay = evaluateLoadRules(input, first.ledger);
    expect(replay.result.loadedBecause).toEqual(first.result.loadedBecause);
  });

  it("`evaluateLoadRules` 契约的 out 形状确实携带 loadedBecause 与 prunedByPriority 两个字段", () => {
    const shape = A.operations.evaluateLoadRules.out;
    const parsed = shape.parse({
      roster: [],
      loadedBecause: [
        { agentId: "agt-scout", triggerEvent: "agenda_segment.switched", matchedRuleId: "rule-1" },
      ],
      prunedByPriority: [{ agentId: "agt-5", ruleId: "r-5" }],
      nextSegmentPreview: [],
      skippedNotRunning: [],
    });
    expect(parsed.loadedBecause).toHaveLength(1);
    expect(parsed.prunedByPriority).toHaveLength(1);
  });

  it("触发事件字面量与契约的 LoadRuleTriggerEvent 枚举一致（不是本模块另起一套字符串）", () => {
    for (const ev of ["agenda_segment.switched", "agenda_segment.state_changed"]) {
      expect(A.LoadRuleTriggerEvent.safeParse(ev).success).toBe(true);
    }
  });
});
