import { research } from "@repo/contracts";
import type { GuidedResearchRuntime } from "./guided-research-api";

export const DEFAULT_RESEARCH_NAME = "新建研究";

export function guidedResearchHeading(state: Pick<GuidedResearchRuntime, "brief" | "generatedNodes">, researchName?: string): string {
  const explicitName = researchName?.trim();
  const goal = state.brief.goal.trim();
  const nameLimit = research.GuidedResearchMetadata.shape.title.maxLength!;
  // Previous intake persisted this exact metadata-limited prefix of a long goal.
  // Other names remain explicit; no general text-length heuristic is used.
  const legacyAutomaticName = goal.length > nameLimit && explicitName === goal.slice(0, nameLimit).trim();
  if (explicitName && explicitName !== DEFAULT_RESEARCH_NAME && !legacyAutomaticName) return explicitName;
  return state.generatedNodes.includes("brief") ? state.brief.topic.trim() || DEFAULT_RESEARCH_NAME : DEFAULT_RESEARCH_NAME;
}
