/**
 * Shared fixture for the three F55 capability tests.
 *
 * Deliberately NOT a factory with defaults for the fields under test: a default
 * `toolWhitelist: []` would make "the clone's whitelist is empty" true before the clone
 * happens. Callers pass the whitelist explicitly.
 */
import type { AgentDefinition } from "../../../src/domain/agent/definition";

export function agent(over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentId: "agt-source",
    orgId: "org-1",
    name: "Ava",
    initials: "AV",
    role: "访谈引导与纪要",
    visibility: "全组织可用",
    cloneFrom: null,
    source: "self",
    instructions: "你是测试夹具里的 agent。",
    publishState: "运行中",
    modelId: "mdl-local-1",
    skillMounts: [{ skillId: "skl-interview", skillVersion: 3 }],
    toolWhitelist: [
      { toolFullName: "mcp:crm.searchAccount", state: "在授权范围内", elevationDecision: null },
      { toolFullName: "graph.readEntity", state: "已准", elevationDecision: null },
    ],
    concurrencyLimit: 2,
    degradePolicy: "跟随组织级",
    ...over,
  };
}
