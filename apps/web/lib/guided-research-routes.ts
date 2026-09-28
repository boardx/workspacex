import type { GuidedResearchVisualStage } from "./guided-research-six-step";

export function guidedResearchRoute(sessionId: string, stage: GuidedResearchVisualStage): string {
  return `/research/${encodeURIComponent(sessionId)}/${stage}`;
}

export const RESEARCH_STAGE_NODES = {
  import: "brief", topic: "directions", plan: "outline", research: "research",
  chapters: "report", report: "report",
} as const;
