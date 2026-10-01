import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";
import { redirect } from "next/navigation";
import { surveyPath, type SurveyDestination } from "@/lib/survey/paths";
import { withProjectId } from "@/components/project/project-links";

export default function SurveyWorkflowPage({ params, searchParams }: {
  params: { surveyId: string };
  searchParams: { step?: string; state?: string; readonly?: string; mode?: string; draft?: string; preview?: string; projectId?: string };
}) {
  const destination = (["design", "publish", "responses", "report", "template"] as const).find(step => step === searchParams.step) ?? "design";
  if (params.surveyId !== "new" && searchParams.step !== "import") return redirect(withProjectId(surveyPath(params.surveyId, destination as SurveyDestination), searchParams.projectId));
  return <LiveSurveyWorkspace key={params.surveyId} surveyId={params.surveyId} initialStep={searchParams.step} creationMode={searchParams.mode === "ai" ? searchParams.mode : undefined} projectId={searchParams.projectId ?? null} />;
}
