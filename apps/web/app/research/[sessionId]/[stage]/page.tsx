import { notFound } from "next/navigation";
import { ResearchStudioApp } from "@/components/research-studio/research-studio-app";
import { GUIDED_RESEARCH_SIX_STEPS, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";
import { RESEARCH_STAGE_NODES } from "@/lib/guided-research-routes";

export const dynamic = "force-dynamic";

export default function ResearchStagePage({ params }: { params: { sessionId: string; stage: string } }) {
  if (!GUIDED_RESEARCH_SIX_STEPS.some((step) => step.id === params.stage)) notFound();
  const stage = params.stage as GuidedResearchVisualStage;
  const node = RESEARCH_STAGE_NODES[stage];
  return <ResearchStudioApp uiState="default" screen="list" view="owner" flow={node === "research" ? "search" : node} guidedSessionId={params.sessionId} visualStage={stage} qs={{}} />;
}
