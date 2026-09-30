/** WF08 —— 「我的运行」列表路由。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { WorkflowRunList } from "@/components/workflow/workflow-lists";

export default function WorkflowMyRunsPage({ searchParams }: { searchParams?: { projectId?: string } }) {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="runs" projectId={searchParams?.projectId ?? null} />}>
      <WorkflowPage title="我的运行">
        <WorkflowRunList />
      </WorkflowPage>
    </AppShell>
  );
}
