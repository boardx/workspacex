/** WF08 —— 「待我审批」列表路由。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { WorkflowApprovalList, WorkflowDecidedApprovalList } from "@/components/workflow/workflow-lists";

export default function WorkflowApprovalsPage({ searchParams }: { searchParams?: { projectId?: string } }) {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="approvals" projectId={searchParams?.projectId ?? null} />}>
      <WorkflowPage active="approvals" projectId={searchParams?.projectId ?? null} title="待我审批" subtitle={searchParams?.projectId ? "这里是你在所有项目里的待审批事项，不只是本项目的。" : undefined}>
        <WorkflowApprovalList />
        <section aria-labelledby="workflow-decided-heading" className="mt-8 space-y-2">
          <h2 id="workflow-decided-heading" className="text-13 font-semibold">已处理</h2>
          <WorkflowDecidedApprovalList />
        </section>
      </WorkflowPage>
    </AppShell>
  );
}
