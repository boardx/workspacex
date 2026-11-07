import { I18nText } from "@/lib/i18n/text";
/** WF08 —— 「我的运行」列表路由。 */
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { WorkflowRunList } from "@/components/workflow/workflow-lists";

export default function WorkflowMyRunsPage({ searchParams }: { searchParams?: { projectId?: string } }) {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="runs" projectId={searchParams?.projectId ?? null} />}>
      <WorkflowPage active="runs" projectId={searchParams?.projectId ?? null} title={<I18nText message="workflows.runsHeading" />}>
        <WorkflowRunList />
      </WorkflowPage>
    </AppShell>
  );
}
