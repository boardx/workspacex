import { SurveyResourceLibrary } from "@/components/survey/resource-library/survey-resource-library";
import type { SurveyResourceState, SurveyResourceTab } from "@/lib/survey/resource-library";

export default function SurveyPage({ searchParams }: {
  searchParams: { tab?: string; state?: string };
}) {
  const tab: SurveyResourceTab = searchParams.tab === "templates" ? "templates" : "surveys";
  const uiState: SurveyResourceState = (["loading", "empty", "error"] as const).includes(searchParams.state as "loading" | "empty" | "error")
    ? searchParams.state as SurveyResourceState
    : "default";
  return <SurveyResourceLibrary initialTab={tab} uiState={uiState} />;
}
