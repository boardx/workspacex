/** WF08 —— 「我的运行」列表路由。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { WorkflowRunList } from "@/components/workflow/workflow-lists";

export default function WorkflowMyRunsPage({ searchParams }: { searchParams?: { projectId?: string } }) {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="runs" projectId={searchParams?.projectId ?? null} />}>
      <WorkflowPage active="runs" projectId={searchParams?.projectId ?? null} title="我的运行" subtitle={searchParams?.projectId ? "这里是你参与的全部工作流运行，不只是本项目的——只看本项目请用「运行看板」。" : undefined}>
        <WorkflowRunList />
      </WorkflowPage>
    </AppShell>
  );
}
