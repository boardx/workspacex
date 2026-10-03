"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getGuidedResearchSession } from "@/lib/guided-research-api";
import { getStoredSessionToken } from "@/lib/api-client";
import { readResearchMemory, writeResearchMemory } from "@/lib/guided-research-memory";
import { GuidedResearchLive } from "./guided-research-live";
import { RESEARCH_STAGE_NODES } from "@/lib/guided-research-routes";
import type { GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export function ResearchStageRoute({ sessionId, stage }: { sessionId: string; stage: GuidedResearchVisualStage }) {
  const router = useRouter();
  const cacheScope = getStoredSessionToken();
  const [metadata, setMetadata] = useState<{ sessionId: string; title: string; scope: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    const name = readResearchMemory(sessionId, cacheScope)?.name;
    (name ? Promise.resolve({ title: name }) : getGuidedResearchSession(sessionId)).then((session) => {
      if (active) {
        setMetadata({ sessionId, title: session.title, scope: cacheScope });
        writeResearchMemory(sessionId, { name: session.title }, cacheScope);
      }
    }).catch(() => { /* Runtime loading owns access and connection errors. */ });
    return () => { active = false; };
  }, [sessionId, cacheScope]);
  const researchName = metadata?.sessionId === sessionId && metadata.scope === cacheScope ? metadata.title : "研究";
  return <GuidedResearchLive sessionId={sessionId} researchName={researchName} visualStage={stage} initialNode={RESEARCH_STAGE_NODES[stage]} onBack={() => router.push("/research")} />;
}
