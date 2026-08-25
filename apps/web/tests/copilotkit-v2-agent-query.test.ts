/**
 * issue #2038 —— `buildAguiAgentQuery` 三态分支的单测。
 *
 * 这段接线正是 devapp 实测事故的现场（env 被配成 `agent_versions.id`，未选 agent
 * 首屏发消息整条轨道 AGENT_NOT_FOUND）：header 选择必须严格透传且**不带**来源标记
 * （服务端对用户手选零回退）；env 兜底必须带 `agentIdSource=env-default` 标记
 * （服务端据此才敢在解析失败时落 org 动态默认，而不是把用户手选也一并回退掉）；
 * 两者都没有必须产出空串（服务端按 principal 的 org 解析，route 层不再 throw）。
 * 真栈行为（服务端三级解析本体）由 `e2e/copilotkit-v2-default-agent.spec.ts` 取证，
 * 本文件只钉 route 层的透传形状。
 */
import { describe, expect, it } from "vitest";
import { buildAguiAgentQuery } from "../lib/copilotkit-v2-agent-query";

describe("buildAguiAgentQuery", () => {
  it("header 选择优先：严格透传、URL 编码、不带 env-default 来源标记", () => {
    expect(buildAguiAgentQuery("agent-a", "agent-env")).toBe("?agentId=agent-a");
    expect(buildAguiAgentQuery(" agent-a ", undefined)).toBe("?agentId=agent-a");
    expect(buildAguiAgentQuery("a/b c", undefined)).toBe("?agentId=a%2Fb%20c");
    expect(buildAguiAgentQuery("agent-a", "agent-env")).not.toContain("agentIdSource");
  });

  it("无选择、env 配了：透传 env 值并标记 agentIdSource=env-default", () => {
    expect(buildAguiAgentQuery(null, "agent-env")).toBe(
      "?agentId=agent-env&agentIdSource=env-default",
    );
    expect(buildAguiAgentQuery("", "agent-env")).toBe(
      "?agentId=agent-env&agentIdSource=env-default",
    );
    expect(buildAguiAgentQuery("   ", " agent-env ")).toBe(
      "?agentId=agent-env&agentIdSource=env-default",
    );
  });

  it("都没有：空串——route 层不 throw，把默认解析让给有 org 上下文的服务端", () => {
    expect(buildAguiAgentQuery(null, undefined)).toBe("");
    expect(buildAguiAgentQuery(null, "")).toBe("");
    expect(buildAguiAgentQuery("", "   ")).toBe("");
  });
});
