import type { GuidedResearchSession } from "./guided-research-api";
import type { GuidedResearchStep } from "./mock/guided-research";

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
  // Confirmed checkpoints are immutable in F180. Returning to one would expose
  // an editor whose mutation endpoints correctly reject the stale stage.
  return maxGuidedResearchStep(session);
}
