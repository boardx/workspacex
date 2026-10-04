import { research } from "@repo/contracts";
import type { GuidedResearchRuntime } from "./guided-research-api";

export const DEFAULT_RESEARCH_NAME = "新建研究";

// Only known automatic signatures are candidates; unrelated names remain explicit.
export function isAutomaticResearchName(goal: string, researchName?: string): boolean {
  const name = researchName?.trim();
  const trimmedGoal = goal.trim();
  const nameLimit = research.GuidedResearchMetadata.shape.title.maxLength!;
  return !name || name === DEFAULT_RESEARCH_NAME ||
    (trimmedGoal.length > nameLimit && name === trimmedGoal.slice(0, nameLimit).trim());
}

export function guidedResearchHeading(state: Pick<GuidedResearchRuntime, "brief" | "generatedNodes">, researchName?: string): string {
  if (!isAutomaticResearchName(state.brief.goal, researchName)) return researchName!.trim();
  return state.generatedNodes.includes("brief") ? state.brief.topic.trim() || DEFAULT_RESEARCH_NAME : DEFAULT_RESEARCH_NAME;
}
