import { NewProjectFlow } from "@/components/project/new-project-flow";
import { mockIdentity } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";

/**
 * 新建项目向导（`/project/new`）—— C-2 缺屏。原型 wsCreateView 的转译。
 * 服务端组件：只解析 state / org，事件处理下沉到客户端 NewProjectFlow。
 * ⚠ 新建项目= 建一场**工作坊**（四种项目角色）；研究项目/用户洞察是另两类容器，不在此建。
 */
export default function NewProjectPage({
  searchParams,
}: {
  searchParams: { state?: string; org?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", null);
  return <NewProjectFlow identity={identity} state={state} />;
}
