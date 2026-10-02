import { ModelCallError, type ClaimedAgentRun } from "./ports";

/** Revalidate immutable execution snapshots before reading any skill content. */
export function assertFrozenAgentSkillScope(
  run: Pick<ClaimedAgentRun, "skillScope" | "agentPinnedSkillVersionIds" | "skillVersionIds">,
): void {
  if (run.skillScope !== "agent_pins") return;
  const pins = run.agentPinnedSkillVersionIds;
  if (!pins || run.skillVersionIds.some(id => !pins.includes(id))) {
    throw new ModelCallError(
      "SKILL_VERSION_UNAVAILABLE",
      "AGENT_SKILL_SCOPE_VIOLATION: run skills exceed the frozen agent version pins",
    );
  }
}
