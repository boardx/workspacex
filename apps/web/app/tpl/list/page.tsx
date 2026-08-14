import { AppShell } from "@/components/shell/app-shell";
import { BlueprintListScreenLive } from "@/components/tpl/blueprint-list-screen-live";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * `/tpl/list` —— 「项目模板」的**生产入口**（后台左栏「AI 能力 → 项目模板」点进来落地的地方，
 * 见 `lib/mock/admin.ts` 的 `ADMIN_NAV` `blueprint` 项）。
 *
 * BP-05：从纯 mock 切到真实 `GET/POST /blueprints`（同 F353 `ProjectsScreen` 的切法）。
 * ⚠ 与 `/tpl`（原型切换器路径，ADR-023 UI 先行的签核材料，`BlueprintListScreen` +
 *   `TplNav`/`PreviewControls` 脚手架）区分开——那条路径**不受本次改动影响**，
 *   继续用 mock 数据服务七态预览与卡片网格/标签过滤的视觉签核（#1158）。
 *
 * 服务端组件只解析 `as`（预览视角，装饰用）；真实登录态与组织 id 下沉到客户端组件
 * `BlueprintListScreenLive`（走 `useSession()`，同 `ProjectsScreen`），不在这里传 mock 身份——
 * `AppShell` 不传 `identity` 时会自己去读真实会话（见其内部 `AppShellReal` 分支）。
 *
 * designer/apply/prep/workflow/promote/versions 六屏目前仍只有原型形态，
 * 继续通过 `/tpl?screen=xxx` 访问，不受本页影响（designer 的真实挂载点 `/tpl/designer`
 * 内部仍是 mock 蓝本数据，接线是后续 BP 的范围，见 `blueprint-list-screen-live.tsx` 头注）。
 */
export default function TplListPage({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole}>
      <BlueprintListScreenLive />
    </AppShell>
  );
}
