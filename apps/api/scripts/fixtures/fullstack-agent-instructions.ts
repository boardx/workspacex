import { DEFAULT_AGENT_INSTRUCTIONS } from "../../src/application/agent/ensure-default-agent";

/** Default deterministic smoke stays unchanged; only the explicit paid AIDT stack opts in. */
export function fullstackAgentInstructions(profile: string | undefined): string {
  if (profile === undefined || profile === "loopback-echo") return "You are the core-loop smoke agent. Echo back what you are given.";
  if (profile === "canonical-default") return DEFAULT_AGENT_INSTRUCTIONS;
  throw new Error("FULLSTACK_E2E_AGENT_INSTRUCTIONS_PROFILE_INVALID");
}
