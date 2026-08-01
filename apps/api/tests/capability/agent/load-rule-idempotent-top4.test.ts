/**
 * F57 / I-35 / I-37 / E2 / E4 -- 载入规则求值：幂等重放 + 命中多条取前 4（被裁剪可查）+
 * 引用的 agent 不在运行中时跳过（不静默降级）+ 跑批中的 agent 不因环节切换被强杀。
 *
 * `user_visible_behavior`: 「…按载入规则重新求值，命中多条时按优先级取前 4 个、被裁剪的可查…
 * 跑批中的 agent 在切环节时不被强杀，后台任务跑完仍回本线程…同一状态事件重复投递不重复载入、
 * 计数不翻倍。」
 */
import { describe, expect, it } from "vitest";
import {
  evaluateLoadRules,
  evaluateLoadRulesOnce,
  MAX_LOADED_BY_PRIORITY,
  type EvaluateLoadRulesInput,
  type LoadableAgentFact,
  type LoadRule,
  type LoadRuleLedgerEntry,
} from "../../../src/domain/agent/load-rule-evaluation";

function runningAgent(over: Partial<LoadableAgentFact> = {}): LoadableAgentFact {
  return {
    agentId: "agt-1",
    name: "Ava",
    agentVersionId: "av-1",
    publishState: "运行中",
    ...over,
  };
}

function rule(over: Partial<LoadRule> = {}): LoadRule {
  return {
    ruleId: "rule-1",
    triggerEvent: "agenda_segment.switched",
    agendaSegmentId: "seg-1",
    priority: 1,
    agentId: "agt-1",
    ...over,
  };
}

const FIVE_AGENTS: LoadableAgentFact[] = [
  runningAgent({ agentId: "agt-1", name: "Ava" }),
  runningAgent({ agentId: "agt-2", name: "Atlas" }),
  runningAgent({ agentId: "agt-3", name: "Scout" }),
  runningAgent({ agentId: "agt-4", name: "Warden" }),
  runningAgent({ agentId: "agt-5", name: "Echo" }),
];

const FIVE_RULES: LoadRule[] = [
  rule({ ruleId: "r-1", agentId: "agt-1", priority: 1 }),
  rule({ ruleId: "r-2", agentId: "agt-2", priority: 2 }),
  rule({ ruleId: "r-3", agentId: "agt-3", priority: 3 }),
  rule({ ruleId: "r-4", agentId: "agt-4", priority: 4 }),
  rule({ ruleId: "r-5", agentId: "agt-5", priority: 5 }),
];

function baseInput(over: Partial<EvaluateLoadRulesInput> = {}): EvaluateLoadRulesInput {
  return {
    event: "agenda_segment.switched",
    agendaSegmentId: "seg-1",
    idempotencyKey: "evt-1",
    rules: FIVE_RULES,
    agents: new Map(FIVE_AGENTS.map((a) => [a.agentId, a])),
    currentRoster: [],
    ...over,
  };
}

describe("F57 I-37 / E1 -- 命中多条规则时按优先级取前 4，被裁剪的可查", () => {
  it("5 条规则全部命中，只有优先级最高的 4 个被载入，第 5 个进 prunedByPriority", () => {
    const result = evaluateLoadRulesOnce(baseInput());
    expect(result.loadedBecause).toHaveLength(MAX_LOADED_BY_PRIORITY);
    expect(result.loadedBecause.map((e) => e.agentId)).toEqual([
      "agt-1",
      "agt-2",
      "agt-3",
      "agt-4",
    ]);
    // 反向断言：被裁剪的不是静默丢弃，而是可查的一条记录，带上是哪条规则。
    expect(result.prunedByPriority).toEqual([{ agentId: "agt-5", ruleId: "r-5" }]);
    expect(result.roster.map((r) => r.agentId)).toEqual(["agt-1", "agt-2", "agt-3", "agt-4"]);
  });

  it("反向断言：只有 3 条规则命中时，不发生任何裁剪（不是恒裁掉最后一个的实现）", () => {
    const result = evaluateLoadRulesOnce(
      baseInput({ rules: FIVE_RULES.slice(0, 3), agents: new Map(FIVE_AGENTS.slice(0, 3).map((a) => [a.agentId, a])) }),
    );
    expect(result.loadedBecause).toHaveLength(3);
    expect(result.prunedByPriority).toEqual([]);
  });

  it("优先级数值越小越优先——打乱输入顺序后，取前 4 的结果不变（稳定排序，不依赖输入顺序）", () => {
    const shuffled = [4, 1, 3, 0, 2].map((i): LoadRule => {
      const r = FIVE_RULES[i];
      if (r === undefined) throw new Error("fixture");
      return r;
    });
    const result = evaluateLoadRulesOnce(baseInput({ rules: shuffled }));
    expect(result.loadedBecause.map((e) => e.agentId)).toEqual([
      "agt-1",
      "agt-2",
      "agt-3",
      "agt-4",
    ]);
  });
});

describe("F57 E2 -- 规则引用的 agent 不在运行中时跳过，不静默降级为别的 agent", () => {
  it("agt-2 已停用：它被跳过并出现在 skippedNotRunning，agt-5（第 5 优先级）不会顶替它的名额", () => {
    const agents = new Map(
      FIVE_AGENTS.map((a) => [a.agentId, a.agentId === "agt-2" ? { ...a, publishState: "已停用" as const } : a]),
    );
    const result = evaluateLoadRulesOnce(baseInput({ agents }));
    expect(result.skippedNotRunning).toEqual(["agt-2"]);
    // 反向断言：agt-5 没有因为 agt-2 空出名额而被悄悄载入——它仍然是"第 5 名"，被优先级裁掉。
    expect(result.loadedBecause.map((e) => e.agentId)).toEqual(["agt-1", "agt-3", "agt-4", "agt-5"]);
    expect(result.prunedByPriority).toEqual([]);
  });

  it("规则引用的 agentId 在 agents 池里完全不存在时同样跳过，而不是抛错或静默忽略", () => {
    const agents = new Map(FIVE_AGENTS.filter((a) => a.agentId !== "agt-3").map((a) => [a.agentId, a]));
    const result = evaluateLoadRulesOnce(baseInput({ agents }));
    expect(result.skippedNotRunning).toContain("agt-3");
    expect(result.loadedBecause.some((e) => e.agentId === "agt-3")).toBe(false);
  });
});

describe("F57 E4 -- 跑批中的 agent 在议程环节切换时不被强杀", () => {
  it("Ledger 当前跑批中且本轮规则未再命中它 ⇒ 仍留在新 roster 里，presence 保持跑批中", () => {
    const currentRoster = [
      { agentId: "agt-ledger", name: "Ledger", presence: "跑批中" as const, agentVersionId: "av-ledger" },
    ];
    // 本轮切到 seg-2，规则表里没有任何一条引用 agt-ledger。
    const result = evaluateLoadRulesOnce(
      baseInput({
        agendaSegmentId: "seg-2",
        rules: [rule({ ruleId: "r-1", agentId: "agt-1", agendaSegmentId: "seg-2" })],
        currentRoster,
      }),
    );
    const ledgerEntry = result.roster.find((r) => r.agentId === "agt-ledger");
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry?.presence).toBe("跑批中");
    // 反向断言：其他不在跑批中态、也未被本轮重新命中的旧成员确实被换出（不是"全员留任"）。
    expect(result.roster.some((r) => r.agentId === "agt-2")).toBe(false);
  });

  it("跑批中的 agent 若本轮又被重新命中，改为在场态（不是继续挂跑批中）", () => {
    const currentRoster = [
      { agentId: "agt-1", name: "Ava", presence: "跑批中" as const, agentVersionId: "av-1" },
    ];
    const result = evaluateLoadRulesOnce(baseInput({ currentRoster }));
    const entry = result.roster.find((r) => r.agentId === "agt-1");
    expect(entry?.presence).toBe("在场");
  });
});

describe("F57 I-35 -- 同一状态事件重复投递不重复载入、计数不翻倍（幂等）", () => {
  it("同一 idempotencyKey 求值两次：第二次是重放，roster 与 loadedBecause 与第一次完全一致，账本不追加第二条", () => {
    const input = baseInput();
    const first = evaluateLoadRules(input, []);
    expect(first.replayed).toBe(false);
    expect(first.ledger).toHaveLength(1);

    const second = evaluateLoadRules(input, first.ledger);
    expect(second.replayed).toBe(true);
    expect(second.ledger).toHaveLength(1); // 没有追加第二条账本
    expect(second.result).toEqual(first.result); // 同一个结果，不是重新计算出的等价结果
    expect(second.result.loadedBecause).toHaveLength(MAX_LOADED_BY_PRIORITY); // 计数没有翻倍
  });

  it("反向断言：不同 idempotencyKey 的两次求值都会各自入账，不是「第一次之后全部当重放」", () => {
    const first = evaluateLoadRules(baseInput({ idempotencyKey: "evt-1" }), []);
    const second = evaluateLoadRules(baseInput({ idempotencyKey: "evt-2" }), first.ledger);
    expect(second.replayed).toBe(false);
    expect(second.ledger).toHaveLength(2);
  });

  it("重放请求即使换了一套不同的 rules/agents 输入，仍然原样返回上次账本里记录的结果（键相同即视为同一事件）", () => {
    const first = evaluateLoadRules(baseInput({ idempotencyKey: "evt-1" }), []);
    const differentPayloadSameKey = baseInput({
      idempotencyKey: "evt-1",
      rules: FIVE_RULES.slice(0, 1),
    });
    const replay = evaluateLoadRules(differentPayloadSameKey, first.ledger);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
  });

  it("LoadRuleLedgerEntry 是账本的唯一形状——直接构造一个手工账本也能被正确识别为已存在", () => {
    const manualLedger: readonly LoadRuleLedgerEntry[] = [
      { idempotencyKey: "evt-manual", result: evaluateLoadRulesOnce(baseInput()) },
    ];
    const outcome = evaluateLoadRules(baseInput({ idempotencyKey: "evt-manual" }), manualLedger);
    expect(outcome.replayed).toBe(true);
    expect(outcome.ledger).toBe(manualLedger); // 未被替换成新数组
  });
});

describe("F57 -- 触发事件只引用 agendaSegmentId（D-03a / I-36）", () => {
  it("不同 agendaSegmentId 的规则不命中当前环节的求值", () => {
    const result = evaluateLoadRulesOnce(
      baseInput({ rules: [rule({ agendaSegmentId: "seg-other" })] }),
    );
    expect(result.loadedBecause).toEqual([]);
  });

  it("不同 triggerEvent 的规则不命中（switched 规则不应用于 state_changed 求值）", () => {
    const result = evaluateLoadRulesOnce(
      baseInput({
        event: "agenda_segment.state_changed",
        rules: [rule({ triggerEvent: "agenda_segment.switched" })],
      }),
    );
    expect(result.loadedBecause).toEqual([]);
  });
});
