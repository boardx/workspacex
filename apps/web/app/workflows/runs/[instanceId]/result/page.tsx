/** UC-WC-3 —— 运行产出页（运行面板阶段产出链接的落点）。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { WorkflowOutputViewer } from "@/components/workflow/workflow-output-viewer";

export default function WorkflowRunOutputPage({
  params,
  searchParams,
}: {
  params: { instanceId: string };
  searchParams?: { output?: string | string[] };
}) {
  const raw = searchParams?.output;
  const outputId = typeof raw === "string" && raw.length > 0 ? raw : null;
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="runs" />}>
      <WorkflowPage>
        <WorkflowOutputViewer instanceId={decodeURIComponent(params.instanceId)} outputId={outputId} />
      </WorkflowPage>
    </AppShell>
  );
}
