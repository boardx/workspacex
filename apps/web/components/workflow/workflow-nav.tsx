/** WF08 —— Workflow 路由左栏导航（我的运行 / 待我审批）；CT10 加 Board 运行卡视图。 */
export function WorkflowNav({ active }: { readonly active: "runs" | "approvals" | "board" }) {
  return (
    <nav aria-label="Workflow" data-testid="workflow-nav">
      <a href="/workflows/runs" aria-current={active === "runs" ? "page" : undefined}>我的运行</a>
      <a href="/workflows/approvals" aria-current={active === "approvals" ? "page" : undefined}>待我审批</a>
      <a href="/workflows/board" aria-current={active === "board" ? "page" : undefined}>运行看板</a>
    </nav>
  );
}
