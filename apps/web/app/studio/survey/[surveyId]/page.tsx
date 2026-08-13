import { survey } from "@repo/contracts";
import { SurveyWorkflowShell, type SurveyPrototypeState } from "@/components/survey/workflow/survey-workflow-shell";

export default function SurveyWorkflowPage({ params, searchParams }: {
  params: { surveyId: string };
  searchParams: { step?: string; state?: string; readonly?: string; module?: string; mode?: string };
}) {
  const parsedStep = survey.SurveyWorkflowStepSchema.safeParse(searchParams.step);
  const state = (["loading", "empty", "error"] as const).includes(searchParams.state as "loading" | "empty" | "error")
    ? searchParams.state as SurveyPrototypeState
    : "default";
  return <SurveyWorkflowShell surveyId={params.surveyId} initialStep={parsedStep.success ? parsedStep.data : "design"} uiState={state} readonly={searchParams.readonly === "1"} moduleId={searchParams.module} moduleEditor={searchParams.mode === "module"} />;
}
