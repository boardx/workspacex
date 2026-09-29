import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";

export default function SurveyTemplatePage({ params, searchParams }: { params: { surveyId: string }; searchParams: { projectId?: string } }) {
  return <LiveSurveyWorkspace surveyId={params.surveyId} initialStep="template" projectId={searchParams.projectId ?? null} />;
}
