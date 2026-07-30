import { CanvasHub } from "@/components/canvas/canvas-hub";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveCanvasScreen } from "@/lib/mock/canvas";

/**
 * canvas 能力域 · UI 先行原型（顶层路由 /canvas · 并行安全）
 *
 * ADR-023 签核第 ① 件材料。覆盖 07-canvas 四份 UC / 8 feature（F100-F107）。
 * ⚠ 服务端组件：只解析 URL、组装身份投影，把可序列化 props 交给客户端 CanvasHub。
 *    真实权限在服务端（NestJS Guard + PostgreSQL RLS）；这里的屏/视角/状态切换只是预览。
 */
export default function CanvasPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; screen?: string; conflict?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const screen = resolveCanvasScreen(searchParams.screen);
  const initialConflict = searchParams.conflict === "on" || searchParams.conflict === "1";

  return (
    <CanvasHub
      identity={identity}
      previewRole={previewRole}
      uiState={uiState}
      screen={screen}
      initialConflict={initialConflict}
    />
  );
}
