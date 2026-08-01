/**
 * F57 / I-34 -- 编制数（`rosterCount`）与在场数（`presentCount`）是两个口径，接口不得混用同一个键。
 *
 * `user_visible_behavior`: 「侧栏显示编制数、线程头部显示在场数，两个口径分别标注不混用
 * （如"在场 4 / 编制 6"）」。锚点：`chat-team-panel` / `chat-header-present-count` /
 * `chat-header-roster-count`（三个 testid 已建成于 apps/web/components/chat/）。
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import {
  projectThreadAiTeam,
  type AgentPresenceT,
} from "../../../src/domain/agent/load-rule-evaluation";

function presence(over: Partial<AgentPresenceT> = {}): AgentPresenceT {
  return {
    agentId: "agt-1",
    name: "Ava",
    presence: "在场",
    agentVersionId: "av-1",
    ...over,
  };
}

describe("F57 I-34 -- rosterCount 与 presentCount 是两个独立字段，不共享同一个计数", () => {
  it("编制 6 / 在场 4（原型逐字场景）：6 人在编制里，只有 4 人当前在场", () => {
    const roster: AgentPresenceT[] = [
      presence({ agentId: "agt-1", presence: "在场" }),
      presence({ agentId: "agt-2", presence: "在场" }),
      presence({ agentId: "agt-3", presence: "在场" }),
      presence({ agentId: "agt-4", presence: "在场" }),
      presence({ agentId: "agt-5", presence: "跑批中" }),
      presence({ agentId: "agt-6", presence: "静音" }),
    ];
    const projection = projectThreadAiTeam(roster);
    expect(projection.rosterCount).toBe(6);
    expect(projection.presentCount).toBe(4);
    // 反向断言：两个数字不相等——一个把它们混为一谈的实现在这个场景下会露馅。
    expect(projection.rosterCount).not.toBe(projection.presentCount);
  });

  it("全员在场时两个计数恰好相等——不是「两个口径永远不同」的反向证明", () => {
    const roster: AgentPresenceT[] = [
      presence({ agentId: "agt-1", presence: "在场" }),
      presence({ agentId: "agt-2", presence: "在场" }),
    ];
    const projection = projectThreadAiTeam(roster);
    expect(projection.rosterCount).toBe(2);
    expect(projection.presentCount).toBe(2);
  });

  it("依赖失败 / 静音 / 跑批中都计入编制数，但都不计入在场数", () => {
    const roster: AgentPresenceT[] = [
      presence({ agentId: "agt-1", presence: "依赖失败" }),
      presence({ agentId: "agt-2", presence: "静音" }),
      presence({ agentId: "agt-3", presence: "跑批中" }),
    ];
    const projection = projectThreadAiTeam(roster);
    expect(projection.rosterCount).toBe(3);
    expect(projection.presentCount).toBe(0);
  });

  it("空团队：两个口径都真实为 0，不是省略字段", () => {
    const projection = projectThreadAiTeam([]);
    expect(projection.rosterCount).toBe(0);
    expect(projection.presentCount).toBe(0);
  });

  it("projection 原样携带 roster 本身，供界面渲染逐行三态", () => {
    const roster: AgentPresenceT[] = [presence({ agentId: "agt-1", presence: "在场" })];
    const projection = projectThreadAiTeam(roster);
    expect(projection.roster).toEqual(roster);
  });

  it("getThreadAiTeam / composeThreadTeam 的契约输出确实是两个独立字段（不是本模块编出来的口径）", () => {
    const outShape = A.operations.getThreadAiTeam.out;
    const parsed = outShape.parse({
      roster: [],
      rosterCount: 6,
      presentCount: 4,
      staleSince: null,
    });
    expect(parsed.rosterCount).toBe(6);
    expect(parsed.presentCount).toBe(4);

    const composeOutShape = A.operations.composeThreadTeam.out;
    const composeParsed = composeOutShape.parse({ roster: [], rosterCount: 6, presentCount: 4 });
    expect(composeParsed.rosterCount).toBe(6);
    expect(composeParsed.presentCount).toBe(4);
  });
});
