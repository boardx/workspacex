import { agentRuntime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";
export type AgentSkillPins = z.infer<typeof agentRuntime.operations.getAgentSkillPins.out>;
export async function getAgentSkillPins(agentId: string): Promise<AgentSkillPins> {
  const op = agentRuntime.operations.getAgentSkillPins;
  const response = op.out.parse(await apiRequest(op.path.replace(":agentId", encodeURIComponent(agentId))));
  if (response.agentId !== agentId) throw new Error("Agent 固定版本读取对象不匹配");
  return response;
}
export async function setAgentSkillPins(agentId: string, expectedVersion: string, skillVersionIds: string[]) {
  const op = agentRuntime.operations.setAgentSkillPins;
  const body = op.in.parse({ agentId, expectedVersion, skillVersionIds });
  const result = op.out.parse(await apiRequest(op.path.replace(":agentId", encodeURIComponent(agentId)), { method: op.method, body }));
  if (result.agentId !== agentId || result.versionId === expectedVersion || JSON.stringify(result.skillVersionIds) !== JSON.stringify(skillVersionIds)) throw new Error("写入响应与请求不一致，请重新读取确认当前绑定");
  return result;
}
/** Replace only this Skill's entries; every other pin keeps its relative order. */
export function replaceSkillPins(pins: AgentSkillPins["pins"], skillId: string, replacements: string[]): string[] {
  const result: string[] = []; let inserted = false;
  for (const pin of pins) {
    if (pin.skillId !== skillId) result.push(pin.versionId);
    else if (!inserted) { result.push(...replacements); inserted = true; }
  }
  if (!inserted) result.push(...replacements);
  return result;
}
