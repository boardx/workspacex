import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";
import { survey } from "@repo/contracts";
import { SurveyWorkflowShell, type SurveyPrototypeState } from "@/components/survey/workflow/survey-workflow-shell";
import { decodeSurveyCreationDraft } from "@/lib/survey/creation-draft";
import { redirect } from "next/navigation";
import { surveyPath, type SurveyDestination } from "@/lib/survey/paths";
import { withProjectId } from "@/components/project/project-breadcrumb";

export default function SurveyWorkflowPage({ params, searchParams }: {
  params: { surveyId: string };
  searchParams: { step?: string; state?: string; readonly?: string; mode?: string; draft?: string; preview?: string; projectId?: string };
}) {
  if (searchParams.preview !== "1") {
    const destination = (["design", "publish", "responses", "report", "template"] as const).find(step => step === searchParams.step) ?? "design";
    if (params.surveyId !== "new" && searchParams.step !== "import") return redirect(withProjectId(surveyPath(params.surveyId, destination as SurveyDestination), searchParams.projectId));
    return <LiveSurveyWorkspace key={params.surveyId} surveyId={params.surveyId} initialStep={searchParams.step} creationMode={searchParams.mode === "ai" ? searchParams.mode : undefined} projectId={searchParams.projectId ?? null} />;
  }
  const parsedStep = survey.SurveyWorkflowStepSchema.safeParse(searchParams.step);
  const state = (["loading", "empty", "error"] as const).includes(searchParams.state as "loading" | "empty" | "error")
    ? searchParams.state as SurveyPrototypeState
    : "default";
  const moduleEditor = searchParams.mode === "module";
  const creationDraft = !moduleEditor && params.surveyId === "new" ? decodeSurveyCreationDraft(searchParams.draft) ?? undefined : undefined;
  return <SurveyWorkflowShell surveyId={params.surveyId} initialStep={parsedStep.success ? parsedStep.data : "design"} uiState={state} readonly={searchParams.readonly === "1"} moduleEditor={moduleEditor} creationDraft={creationDraft} />;
}
