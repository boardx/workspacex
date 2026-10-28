"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getGuidedResearchSession } from "@/lib/guided-research-api";
import { readResearchMemory, writeResearchMemory, getResearchMemoryScope, readResearchOnce } from "@/lib/guided-research-memory";
import { GuidedResearchLive } from "./guided-research-live";
import { RESEARCH_STAGE_NODES } from "@/lib/guided-research-routes";
import type { GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export function ResearchStageRoute({ sessionId, stage }: { sessionId: string; stage: GuidedResearchVisualStage }) {
  const router = useRouter();
  const cacheScope = getResearchMemoryScope();
  const [metadata, setMetadata] = useState<{ sessionId: string; title: string; scope: string | null } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    readResearchOnce(sessionId, "metadata", cacheScope, () => getGuidedResearchSession(sessionId)).then((session) => {
      if (active && getResearchMemoryScope() === cacheScope) {
        setMetadata({ sessionId, title: session.title, scope: cacheScope });
        writeResearchMemory(sessionId, { name: session.title }, cacheScope);
      }
    }).catch(() => { /* Runtime loading owns access and connection errors. */ });
    return () => { active = false; };
  }, [sessionId, cacheScope, stage, loadAttempt]);
  const researchName = metadata?.sessionId === sessionId && metadata.scope === cacheScope ? metadata.title : readResearchMemory(sessionId, cacheScope)?.name;
  return <GuidedResearchLive sessionId={sessionId} researchName={researchName} onLoadRetry={() => setLoadAttempt((attempt) => attempt + 1)} visualStage={stage} initialNode={RESEARCH_STAGE_NODES[stage]} onBack={() => router.push("/research")} />;
}
