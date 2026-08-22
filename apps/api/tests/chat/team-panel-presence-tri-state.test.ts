/**
 * F110 —— AI 团队面板的在场三态与「编制 ≠ 在场」（chat 束 domain.md I-17 / I-18，uc-8-2 UC-7）。
 *
 * ⚠ **纯逻辑单测，不连数据库**（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   被测的是 `domain/chat/agent-presence.ts` 这一处唯一的计算——与
 *   `thread-badge-single-source.test.ts` 同一个纪律：先证明「三态互相能区分」，
 *   不只是断言一个数量。
 *
 * ## 这个文件最重要的两条断言
 *
 * 1. **三态要能互相区分，不只是数量断言**——一个把 `away`/`off` 都算成
 *    「不在场」的实现能通过任何单纯的 `presentCount` 数值断言；
 *    所以下面既断言 `presentCount`，也逐个断言每个 agent 的 `presence` 字面值。
 * 2. **I-18：`presentCount` 与 `rosterCount` 不得互相顶替**——用一组
 *    「在场数 < 编制数」的夹具，证明两个数不是同一个数刷两遍。
 */
import { describe, expect, it } from "vitest";
import {
  AgentDutyEmptyError,
  AgentRoleLabelEmptyError,
  agentPanelCounts,
  assertAgentPanelInvariants,
  type AgentPanelAgent,
} from "../../src/domain/chat/agent-presence";

const agents: AgentPanelAgent[] = [
  { id: "av", abbr: "AV", name: "Ava", duty: "拆问题、标致命假设", roleLabel: "战略分析师", presence: "present" },
  { id: "at", abbr: "AT", name: "Atlas", duty: "把业务流拆成任务", roleLabel: "任务规划师", presence: "present" },
  { id: "sc", abbr: "SC", name: "Scout", duty: "找同行案例", roleLabel: "调研专员", presence: "away" },
  { id: "lg", abbr: "LG", name: "Ledger", duty: "算人天节省", roleLabel: "财务分析师", presence: "off" },
];

describe("F110 AgentPresence 三态", () => {
  it("三态互相区分：present/away/off 各自可辨认，不是「在场 vs 其余」的二分", () => {
    const byId = new Map(agents.map((a) => [a.id, a.presence]));
    expect(byId.get("av")).toBe("present");
    expect(byId.get("sc")).toBe("away");
    expect(byId.get("lg")).toBe("off");
    // 三态是三个不同的字面量，不是布尔的伪装——集合大小必须是 3。
    expect(new Set(agents.map((a) => a.presence)).size).toBe(3);
  });

  it("I-18：presentCount 恒等于 presence==='present' 的 agent 数", () => {
    const { presentCount } = agentPanelCounts(agents);
    expect(presentCount).toBe(agents.filter((a) => a.presence === "present").length);
    expect(presentCount).toBe(2);
  });

  it("I-18：rosterCount 与 presentCount 分离——编制数不因在场数变化而变化", () => {
    const { presentCount, rosterCount } = agentPanelCounts(agents);
    expect(rosterCount).toBe(agents.length);
    expect(rosterCount).toBe(4);
    // 关键断言：两个数不相等——证明不是同一个数刷了两遍（I-18 逐字禁止互相顶替）。
    expect(rosterCount).not.toBe(presentCount);
  });

  it("反证：away 与 off 都不计入在场——把它们错记成 present 就会让下面这条变红", () => {
    const allAway: AgentPanelAgent[] = [
      { id: "x1", abbr: "X1", name: "X1", duty: "d", roleLabel: "r", presence: "away" },
      { id: "x2", abbr: "X2", name: "X2", duty: "d", roleLabel: "r", presence: "off" },
    ];
    expect(agentPanelCounts(allAway).presentCount).toBe(0);
    expect(agentPanelCounts(allAway).rosterCount).toBe(2);
  });

  it("空编制：两个计数都是 0，不是 undefined 或抛错", () => {
    expect(agentPanelCounts([])).toEqual({ presentCount: 0, rosterCount: 0 });
  });

  it("I-17：每个 agent 必须有非空 duty——校验通过时静默放行", () => {
    expect(() => assertAgentPanelInvariants(agents)).not.toThrow();
  });

  it("I-17 反证：空 duty（含纯空格）必须被拒绝，且报出是哪个 agent", () => {
    const bad: AgentPanelAgent[] = [
      { id: "av", abbr: "AV", name: "Ava", duty: "拆问题", roleLabel: "分析师", presence: "present" },
      { id: "silent", abbr: "SL", name: "Silent", duty: "   ", roleLabel: "分析师", presence: "off" },
    ];
    expect(() => assertAgentPanelInvariants(bad)).toThrow(AgentDutyEmptyError);
    try {
      assertAgentPanelInvariants(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgentDutyEmptyError);
      expect((e as AgentDutyEmptyError).agentId).toBe("silent");
    }
  });

  /**
   * #1705（#728 D-1）—— `roleLabel` 版本的 I-17 反证，同上一条同一个理由：
   * 门控写完立刻造反证，不能只靠"正样本全绿"就相信这条断言真的会拦人。
   */
  it("#1705 反证：空 roleLabel（含纯空格）必须被拒绝，且报出是哪个 agent", () => {
    const bad: AgentPanelAgent[] = [
      { id: "av", abbr: "AV", name: "Ava", duty: "拆问题", roleLabel: "分析师", presence: "present" },
      { id: "silent", abbr: "SL", name: "Silent", duty: "职责非空", roleLabel: "   ", presence: "off" },
    ];
    expect(() => assertAgentPanelInvariants(bad)).toThrow(AgentRoleLabelEmptyError);
    try {
      assertAgentPanelInvariants(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgentRoleLabelEmptyError);
      expect((e as AgentRoleLabelEmptyError).agentId).toBe("silent");
    }
  });
});
