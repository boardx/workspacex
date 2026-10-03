"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getGuidedResearchSession } from "@/lib/guided-research-api";
import { GuidedResearchLive } from "./guided-research-live";
import { RESEARCH_STAGE_NODES } from "@/lib/guided-research-routes";
import type { GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export function ResearchStageRoute({ sessionId, stage }: { sessionId: string; stage: GuidedResearchVisualStage }) {
  const router = useRouter();
  const [metadata, setMetadata] = useState<{ sessionId: string; title: string } | null>(null);
  useEffect(() => {
    let active = true;
    getGuidedResearchSession(sessionId).then((session) => {
      if (active) setMetadata({ sessionId, title: session.title });
    }).catch(() => { /* Runtime loading owns access and connection errors. */ });
    return () => { active = false; };
  }, [sessionId]);
  const researchName = metadata?.sessionId === sessionId ? metadata.title : "研究";
  return <GuidedResearchLive sessionId={sessionId} researchName={researchName} visualStage={stage} initialNode={RESEARCH_STAGE_NODES[stage]} onBack={() => router.push("/research")} />;
}
