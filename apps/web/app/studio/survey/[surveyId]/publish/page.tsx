import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";

export default function SurveyPublishPage({ params, searchParams }: { params: { surveyId: string }; searchParams: { projectId?: string } }) {
  return <LiveSurveyWorkspace surveyId={params.surveyId} initialStep="publish" projectId={searchParams.projectId ?? null} />;
}
