import { describe, expect, it } from "vitest";
import {
  buildAgentCapabilityGraphModel,
  skillEditHref,
  MCP_MANAGEMENT_HREF,
} from "@/lib/agent-capability-graph-model";
import type { AgentCapabilityGraphOut } from "@/lib/live-agent-capability-graph";

function fixture(overrides: Partial<AgentCapabilityGraphOut> = {}): AgentCapabilityGraphOut {
  return {
    agentId: "agent-1",
    name: "客服助理",
    roleLabel: "客服",
    skillMounts: [],
    toolWhitelist: [],
    ...overrides,
  };
}

describe("buildAgentCapabilityGraphModel", () => {
  it("空态：没有挂载 skill 也没有授权工具 ⇒ hasCapabilities 为 false", () => {
    const model = buildAgentCapabilityGraphModel(fixture());
    expect(model.hasCapabilities).toBe(false);
    expect(model.skillNodes).toEqual([]);
    expect(model.mcpNodes).toEqual([]);
  });

  it("把 skillMounts 转成节点，优先用目录名，拿不到目录名时原样退回 skillId", () => {
    const data = fixture({
      skillMounts: [
        { skillId: "skill-a", skillVersion: 3 },
        { skillId: "skill-b", skillVersion: 1 },
      ],
    });
    const skillNames = new Map([["skill-a", "PPT 生成"]]);
    const model = buildAgentCapabilityGraphModel(data, skillNames);

    expect(model.hasCapabilities).toBe(true);
    expect(model.skillNodes).toHaveLength(2);
    expect(model.skillNodes[0]).toMatchObject({
      skillId: "skill-a",
      skillVersion: 3,
      label: "PPT 生成",
      href: skillEditHref("skill-a"),
    });
    // 没有目录名映射 ⇒ 原样退回 skillId，不臆造名字
    expect(model.skillNodes[1]).toMatchObject({ skillId: "skill-b", label: "skill-b" });
  });

  it("把 toolWhitelist 的 toolFullName 解析成服务器/工具两段，链接指向 MCP 管理页", () => {
    const data = fixture({
      toolWhitelist: [
        { toolFullName: "mcp:crm-server.submit_inquiry", state: "在授权范围内", elevationDecision: null },
      ],
    });
    const model = buildAgentCapabilityGraphModel(data);

    expect(model.hasCapabilities).toBe(true);
    expect(model.mcpNodes).toHaveLength(1);
    expect(model.mcpNodes[0]).toMatchObject({
      toolFullName: "mcp:crm-server.submit_inquiry",
      serverSlug: "crm-server",
      toolName: "submit_inquiry",
      state: "在授权范围内",
      href: MCP_MANAGEMENT_HREF,
    });
  });

  it("非法/不可解析的 toolFullName 被跳过而不是硬凑一个假节点", () => {
    const data = fixture({
      toolWhitelist: [
        { toolFullName: "not-a-valid-tool-name", state: "在授权范围内", elevationDecision: null },
      ],
    });
    const model = buildAgentCapabilityGraphModel(data);
    expect(model.mcpNodes).toEqual([]);
    expect(model.hasCapabilities).toBe(false);
  });

  it("同时有 skill 与 mcp 时两者都出现", () => {
    const data = fixture({
      skillMounts: [{ skillId: "skill-a", skillVersion: 1 }],
      toolWhitelist: [
        { toolFullName: "mcp:crm.lookup", state: "已准", elevationDecision: null },
      ],
    });
    const model = buildAgentCapabilityGraphModel(data);
    expect(model.hasCapabilities).toBe(true);
    expect(model.skillNodes).toHaveLength(1);
    expect(model.mcpNodes).toHaveLength(1);
  });
});
