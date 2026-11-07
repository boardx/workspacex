"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ResearchIntake } from "./research-intake";
import { GuidedResearchSixStepShell } from "./guided-research-six-step-shell";
import { guidedResearchRoute } from "@/lib/guided-research-routes";
import { toGuidedResearchVisualStage } from "@/lib/guided-research-six-step";

import { withProjectId } from "@/components/project/project-links";
import { linkProjectResource } from "@/lib/live-project-resources";

export function ResearchNewRoute() {
  const router = useRouter();
  const projectId = useSearchParams().get("projectId");
  const [dirty, setDirty] = useState(false);
  return <GuidedResearchSixStepShell current="import" available={["import"]} hasUnsavedChanges={dirty} onBack={() => router.push(withProjectId("/research", projectId))} onNavigate={() => undefined} main={<ResearchIntake session={null} workflow={null} onCreated={async (resourceId) => { if (projectId) await linkProjectResource({ projectId, kind: "guided_research", resourceId }); }} onDirtyChange={setDirty} onPending={() => undefined} onSession={() => undefined} onWorkflow={() => undefined} onNavigate={(step, id) => { if (id) router.push(withProjectId(guidedResearchRoute(id, toGuidedResearchVisualStage({ currentNode: step === "search" ? "research" : step === "home" ? "brief" : step, availableNodes: [] }).current), projectId)); }} />} />;
}
