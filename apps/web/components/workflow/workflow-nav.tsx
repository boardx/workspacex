/** WF08 —— Workflow 路由左栏导航（我的运行 / 待我审批）。 */
export function WorkflowNav({ active }: { readonly active: "runs" | "approvals" }) {
  return (
    <nav aria-label="Workflow" data-testid="workflow-nav">
      <a href="/workflows/runs" aria-current={active === "runs" ? "page" : undefined}>我的运行</a>
      <a href="/workflows/approvals" aria-current={active === "approvals" ? "page" : undefined}>待我审批</a>
    </nav>
  );
}
