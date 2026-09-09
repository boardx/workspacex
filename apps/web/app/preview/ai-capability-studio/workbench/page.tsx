import { CapabilityStudioPreview } from "@/components/ai-capability-studio/workbench-preview";
import { resolvePreviewState } from "@/lib/ui-state";

export default function CapabilityStudioPage({ searchParams }: { searchParams: { state?: string; fromRun?: string } }) {
  return <CapabilityStudioPreview state={resolvePreviewState(searchParams.state)} fromRun={searchParams.fromRun} />;
}
