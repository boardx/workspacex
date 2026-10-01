import { SurveyTemplateLibrary } from "@/components/survey/library/template-library";
import { LiveSurveyLibrary } from "@/components/survey/live/survey-library";

export default function SurveyPage({ searchParams }: {
  searchParams: { tab?: string; state?: string; intent?: string; preview?: string; projectId?: string };
}) {
  if (["modules", "question-templates"].includes(searchParams.tab ?? "")) return <SurveyTemplateLibrary kind="question" />;
  if (["reports", "templates"].includes(searchParams.tab ?? "")) return <SurveyTemplateLibrary kind="report" />;
  return <LiveSurveyLibrary projectId={searchParams.projectId ?? null} />;
}
