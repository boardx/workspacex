"use client";

import { useRouter } from "next/navigation";
import { ResearchIntake } from "./research-intake";
import { GuidedResearchSixStepShell } from "./guided-research-six-step-shell";
import { guidedResearchRoute } from "@/lib/guided-research-routes";
import { toGuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export function ResearchNewRoute() {
  const router = useRouter();
  return <GuidedResearchSixStepShell current="import" available={["import"]} onBack={() => router.push("/research")} onNavigate={() => undefined} main={<ResearchIntake session={null} workflow={null} onPending={() => undefined} onSession={() => undefined} onWorkflow={() => undefined} onNavigate={(step, id) => { if (id) router.push(guidedResearchRoute(id, toGuidedResearchVisualStage({ currentNode: step === "search" ? "research" : step === "home" ? "brief" : step, availableNodes: [] }).current)); }} />} />;
}
