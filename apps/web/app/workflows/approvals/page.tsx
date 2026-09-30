/** WF08 —— 「待我审批」列表路由。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { WorkflowApprovalList, WorkflowDecidedApprovalList } from "@/components/workflow/workflow-lists";

export default function WorkflowApprovalsPage() {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="approvals" />}>
      <WorkflowPage title="待我审批">
        <WorkflowApprovalList />
        <section aria-labelledby="workflow-decided-heading" className="mt-8 space-y-2">
          <h2 id="workflow-decided-heading" className="text-13 font-semibold">已处理</h2>
          <WorkflowDecidedApprovalList />
        </section>
      </WorkflowPage>
    </AppShell>
  );
}
