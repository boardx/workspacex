import { AppShell } from "@/components/shell/app-shell";
import { ProjectsScreen } from "@/components/projects/projects-screen";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * 项目列表（F353 —— 从 `lib/mock/projects.ts` 切到真实 `GET /projects`）。
 *
 * 服务端组件：只读 searchParams（as / org），解析 mock 身份供 `AppShell` 画图标栏/顶栏
 * （壳层装饰，`AppShell` 本身没有真实数据依赖）；真实的登录态与项目数据全部下沉到
 * 客户端组件 `ProjectsScreen`（`?org=` 只是给它一个初始的组织 id 填充值，不是鉴权）。
 * 原型此屏为「单一宽栏」，不带左右上下文栏——故 AppShell 只填 children。
 */
export default function ProjectsPage({
  searchParams,
}: {
  searchParams: { as?: string; org?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole}>
      <ProjectsScreen />
    </AppShell>
  );
}
