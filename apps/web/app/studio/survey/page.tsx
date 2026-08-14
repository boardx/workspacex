import { SurveyResourceLibrary } from "@/components/survey/resource-library/survey-resource-library";
import type { SurveyResourceState, SurveyResourceTab } from "@/lib/survey/resource-library";

export default function SurveyPage({ searchParams }: {
  searchParams: { tab?: string; state?: string; intent?: string };
}) {
  const tab: SurveyResourceTab = searchParams.tab === "templates"
    ? "reports"
    : searchParams.tab === "modules" || searchParams.tab === "reports"
      ? searchParams.tab
      : "surveys";
  const uiState: SurveyResourceState = (["loading", "empty", "error"] as const).includes(searchParams.state as "loading" | "empty" | "error")
    ? searchParams.state as SurveyResourceState
    : "default";
  const intent = searchParams.intent === "create-survey" ? "create-survey" : null;
  return <SurveyResourceLibrary initialTab={tab} initialIntent={intent} uiState={uiState} />;
}
