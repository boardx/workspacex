import { ResearchStudioApp } from "@/components/research-studio/research-studio-app";

export const dynamic = "force-dynamic";

export default function NewResearchPage() {
  return <ResearchStudioApp uiState="default" screen="list" view="owner" flow="brief" qs={{}} />;
}
