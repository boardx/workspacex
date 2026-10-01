import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";

export default function SurveyResponsesPage({ params, searchParams }: { params: { surveyId: string }; searchParams: { projectId?: string } }) {
  return <LiveSurveyWorkspace surveyId={params.surveyId} initialStep="responses" projectId={searchParams.projectId ?? null} />;
}
