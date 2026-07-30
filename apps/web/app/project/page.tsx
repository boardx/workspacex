import { ProjectWorkbench } from "@/components/project/project-workbench";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveProjectTab } from "@/lib/mock/project";

/**
 * 项目工作台（project 域 · phase-01 第 10 个域）—— 顶层路由 `/project`，并行安全。
 * = Layout B（阶段式 tab，原型 wsDetailView 的权威布局）。项目列表在 `/projects`，
 * Layout A（工作面清单）在 `/projects/[projectId]`（两版并存，见 ui-preview README 第六节）。
 *
 * 服务端组件：只解析 URL（state / as / tab / sub / org / orgState），组装身份，把可序列化 props
 * 交给客户端 ProjectWorkbench。事件处理器一律下沉到客户端组件。
 *
 * ⚠ 预览开关生产不可达：`resolvePreviewState` / `resolvePreviewRole` 在
 *    NODE_ENV=production 时分别恒为 default / facilitator（UC-0.4 R12 V8）。
 * ⚠ 真实权限在服务端（NestJS Guard + PostgreSQL RLS）；`?as=` / `?orgState=` 只改本地展示投影。
 */
export default function ProjectPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; tab?: string; sub?: string; orgState?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const view = resolvePreviewRole(searchParams.as) ?? "facilitator";
  const tab = resolveProjectTab(searchParams.tab);
  const sub = typeof searchParams.sub === "string" ? searchParams.sub : null;
  const orgDisabled = process.env.NODE_ENV !== "production" && searchParams.orgState === "disabled";
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", view);

  return (
    <ProjectWorkbench
      identity={identity}
      uiState={uiState}
      tab={tab}
      view={view}
      sub={sub}
      orgDisabled={orgDisabled}
      qs={{ org: searchParams.org }}
    />
  );
}
