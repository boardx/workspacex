"use client";

import { useRouter } from "next/navigation";
import { GuidedResearchLive } from "./guided-research-live";
import { RESEARCH_STAGE_NODES } from "@/lib/guided-research-routes";
import type { GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export function ResearchStageRoute({ sessionId, stage }: { sessionId: string; stage: GuidedResearchVisualStage }) {
  const router = useRouter();
  return <GuidedResearchLive sessionId={sessionId} visualStage={stage} initialNode={RESEARCH_STAGE_NODES[stage]} onBack={() => router.push("/research")} />;
}
