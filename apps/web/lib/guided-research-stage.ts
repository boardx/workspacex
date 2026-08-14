import type { GuidedResearchSession } from "./guided-research-api";
import type { GuidedResearchStep } from "./mock/guided-research";

const ORDER: GuidedResearchStep[] = ["brief", "directions", "outline", "search", "report"];
const STAGE_MAX: Record<GuidedResearchSession["resumeStage"], GuidedResearchStep> = {
  brief: "brief",
  directions: "directions",
  outline: "outline",
  researching: "search",
  report: "report",
};

export function maxGuidedResearchStep(session: GuidedResearchSession): GuidedResearchStep {
  return STAGE_MAX[session.resumeStage];
}

export function clampGuidedResearchStep(
  requested: GuidedResearchStep,
  session: GuidedResearchSession,
): GuidedResearchStep {
  if (requested === "home") return "home";
  const max = maxGuidedResearchStep(session);
  return ORDER.indexOf(requested) <= ORDER.indexOf(max) ? requested : max;
}
