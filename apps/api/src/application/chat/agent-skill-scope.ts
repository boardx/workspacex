/** Selection metadata may never grant a non-default agent the general assistant skill pool. */
export function requiresAgentSkillPins(input: {
  readonly requestedExplicitAgent: boolean;
  readonly resolvedAgentId: string;
  readonly serverDefaultAgentId: string | null;
}): boolean {
  return input.requestedExplicitAgent || input.resolvedAgentId !== input.serverDefaultAgentId;
}

/** Historical snapshots lack this fact; new requests must not reuse a different skill scope. */
export function sameRunSkillScope(existing: "agent_pins" | "general" | null | undefined, incoming: "agent_pins" | "general" | null | undefined): boolean {
  return existing == null || incoming == null || existing === incoming;
}
