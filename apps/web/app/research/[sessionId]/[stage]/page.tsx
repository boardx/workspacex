import { notFound } from "next/navigation";
import { ResearchStageRoute } from "@/components/research-studio/research-stage-route";
import { GUIDED_RESEARCH_SIX_STEPS, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export const dynamic = "force-dynamic";

export default function ResearchStagePage({ params }: { params: { sessionId: string; stage: string } }) {
  if (!GUIDED_RESEARCH_SIX_STEPS.some((step) => step.id === params.stage)) notFound();
  const stage = params.stage as GuidedResearchVisualStage;
  return <ResearchStageRoute sessionId={params.sessionId} stage={stage} />;
}
