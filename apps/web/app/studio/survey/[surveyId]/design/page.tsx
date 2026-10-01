import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";

export default function SurveyDesignPage({ params, searchParams }: { params: { surveyId: string }; searchParams: { projectId?: string } }) {
  return <LiveSurveyWorkspace surveyId={params.surveyId} initialStep="design" projectId={searchParams.projectId ?? null} />;
}
