import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";

export default function SurveyReportPage({ params, searchParams }: { params: { surveyId: string }; searchParams: { projectId?: string } }) {
  return <LiveSurveyWorkspace surveyId={params.surveyId} initialStep="report" projectId={searchParams.projectId ?? null} />;
}
