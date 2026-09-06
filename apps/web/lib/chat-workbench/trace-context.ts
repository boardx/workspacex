"use client";
import { createContext } from "react";
import { agentInterrupts } from "@repo/contracts";
import { CALL_SKILL_TOOL_NAME } from "@/lib/agent-run-phase";
export const RunTraceCoveredContext = createContext(false);
/** These renderers may ask for input; their genuine framework tool IDs stay outside disclosures. */
export function isDecisionTool(name: string): boolean {
  return name === CALL_SKILL_TOOL_NAME || Object.values(agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES).some((value) => value === name);
}
