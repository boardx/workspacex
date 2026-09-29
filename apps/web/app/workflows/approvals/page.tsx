/** WF08 —— 「待我审批」列表路由。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav } from "@/components/workflow/workflow-nav";
import { WorkflowApprovalList } from "@/components/workflow/workflow-lists";

export default function WorkflowApprovalsPage() {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="approvals" />}>
      <h1>待我审批</h1>
      <WorkflowApprovalList />
    </AppShell>
  );
}
