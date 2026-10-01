import { SurveyImportWorkspace } from "@/components/survey/live/survey-import-workspace";
import { decodeSurveyCreationDraft } from "@/lib/survey/creation-draft";

export default function SurveyImportPage({ searchParams }: { searchParams: { draft?: string; projectId?: string } }) {
  return <SurveyImportWorkspace draft={decodeSurveyCreationDraft(searchParams.draft)} projectId={searchParams.projectId ?? null} />;
}
