import { agentDefaults } from "@repo/contracts";

/** Scope follows trusted catalog identity, never a label, fallback selection or client flag. */
export function agentSkillScopeForStableName(stableName: string | null | undefined): "general" | "agent_pins" {
  return stableName === agentDefaults.DEFAULT_AGENT_STABLE_NAME ? "general" : "agent_pins";
}
