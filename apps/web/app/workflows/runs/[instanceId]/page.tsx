/** WF08 —— 运行面板路由（契约束 workflow-runtime ① UI）。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav } from "@/components/workflow/workflow-nav";
import { WorkflowRunPanel } from "@/components/workflow/workflow-run-panel";

export default function WorkflowRunPage({ params }: { params: { instanceId: string } }) {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="runs" />}>
      <WorkflowRunPanel instanceId={decodeURIComponent(params.instanceId)} />
    </AppShell>
  );
}
