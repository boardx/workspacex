"use client";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { deepAgentHitl } from "@repo/contracts";
export const CALL_SKILL_TOOL_NAME = deepAgentHitl.DEEP_AGENT_HITL_TOOL_NAME;
export const callSkillToolParameters = deepAgentHitl.DeepAgentHitlToolArgs;

export function ChatHostToolPermission(): null {
  useHumanInTheLoop({
    name: CALL_SKILL_TOOL_NAME,
    description: "在真正调用这个技能之前，请人确认",
    parameters: callSkillToolParameters,
    // The durable pending request owns approval UI and server-side resume.
    render: () => null,
  });
  return null;
}
