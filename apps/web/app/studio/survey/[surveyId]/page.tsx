import { survey } from "@repo/contracts";
import { SurveyWorkflowShell, type SurveyPrototypeState } from "@/components/survey/workflow/survey-workflow-shell";
import { decodeSurveyCreationDraft } from "@/lib/survey/creation-draft";

export default function SurveyWorkflowPage({ params, searchParams }: {
  params: { surveyId: string };
  searchParams: { step?: string; state?: string; readonly?: string; mode?: string; draft?: string };
}) {
  const parsedStep = survey.SurveyWorkflowStepSchema.safeParse(searchParams.step);
  const state = (["loading", "empty", "error"] as const).includes(searchParams.state as "loading" | "empty" | "error")
    ? searchParams.state as SurveyPrototypeState
    : "default";
  const moduleEditor = searchParams.mode === "module";
  const creationDraft = !moduleEditor && params.surveyId === "new" ? decodeSurveyCreationDraft(searchParams.draft) ?? undefined : undefined;
  return <SurveyWorkflowShell surveyId={params.surveyId} initialStep={parsedStep.success ? parsedStep.data : "design"} uiState={state} readonly={searchParams.readonly === "1"} moduleEditor={moduleEditor} creationDraft={creationDraft} />;
}
