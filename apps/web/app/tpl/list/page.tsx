import { TplListProductionApp } from "@/components/tpl/tpl-app";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";

/**
 * `/tpl/list` —— 「项目模板」的**生产入口**（后台左栏「AI 能力 → 项目模板」点进来落地的地方，
 * 见 `lib/mock/admin.ts` 的 `ADMIN_NAV` `blueprint` 项）。
 *
 * ⚠ 与 `/tpl`（原型切换器路径，ADR-023 UI 先行的签核材料）区分开：
 *   `/tpl` 身兼两职——既是 `list` 屏，又是整套 `TplNav`（UC 编号中间导航列）+
 *   `PreviewControls`（屏/视角/七态切换条）原型脚手架的入口。人类反馈这套脚手架
 *   不该出现在生产入口。本页只渲染 `BlueprintListScreen`，不带这两样。
 *
 *   designer/apply/prep/workflow/promote/versions 六屏目前仍只有原型形态，
 *   继续通过 `/tpl?screen=xxx` 访问，不受本页影响。
 *
 * 服务端组件：只解析 URL、组装身份，把可序列化的 props 交给客户端组件。
 * 纯 mock、零后端，同 `/tpl`。视角/状态切换仍是预览手段，真实权限在服务端 RLS。
 */
export default function TplListPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return <TplListProductionApp identity={identity} previewRole={previewRole} uiState={uiState} />;
}
