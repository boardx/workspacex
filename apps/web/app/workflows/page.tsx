/** uiux-r4 —— `/workflows` 落地：主导航「工作流」入口，直接进「我的运行」（左栏再切 待我审批 / 运行看板）。 */
import { redirect } from "next/navigation";

export default function WorkflowsLandingPage() {
  redirect("/workflows/runs");
}
