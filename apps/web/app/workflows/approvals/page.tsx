/** WF08 —— 「待我审批」列表路由。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { WorkflowApprovalList } from "@/components/workflow/workflow-lists";

export default function WorkflowApprovalsPage() {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="approvals" />}>
      <WorkflowPage title="待我审批">
        <WorkflowApprovalList />
      </WorkflowPage>
    </AppShell>
  );
}
