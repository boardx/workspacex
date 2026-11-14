"use client";
import { useSearchParams } from "next/navigation";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
/** Navigation context never grants Board access; LiveBoard retains its own guard. */
export function AidtBoardReturn() {
  const search = useSearchParams();
  if (!isAidtModuleEnabled() || !search.get("projectId")?.trim() || !AIDT_STEPS.some((step) => String(step.id) === search.get("aidtStep"))) return null;
  return <ProjectBreadcrumb projectId={search.get("projectId")} sub="whiteboard" />;
}
