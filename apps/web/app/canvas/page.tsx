import { CanvasHub } from "@/components/canvas/canvas-hub";
import { resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveCanvasScreen } from "@/lib/canvas-screens";

/**
 * canvas 能力域 hub（顶层路由 /canvas）。
 *
 * #464 起，身份不再由本页伪造：预览身份投影已移除，`AppShell` 在没有 `identity` prop
 * 时走真实 `SessionProvider`（同 `/admin`），未登录会被重定向到 `/login`。
 * 默认屏 `template-admin` 的数据来自 `GET /canvas/templates` 真实响应。
 *
 * ⚠ 其余四屏（模板编辑器 / 环节绑定 / AI 起草 / 回流图谱）后端**一条路由都没有**，
 *   仍是 UI 先行原型；残留的 mock 边由
 *   `tests/session/canvas-template-routes-no-mock.test.ts` 逐条钉住，缺口已报 coord。
 *
 * ⚠ 服务端组件：只解析 URL，把可序列化 props 交给客户端 CanvasHub。
 *   `?as=` / `?state=` 是**预览手段，不是权限实现**；真实权限在服务端（Guard + RLS）。
 */
export default function CanvasPage({
  searchParams,
}: {
  searchParams: {
    state?: string; as?: string; screen?: string; conflict?: string;
    /** #9（2026-08-22）：`template-admin` 屏筛选/视图/搜索词——只有该屏读它们。 */
    filter?: string; view?: string; q?: string;
  };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const screen = resolveCanvasScreen(searchParams.screen);
  const initialConflict = searchParams.conflict === "on" || searchParams.conflict === "1";

  return (
    <CanvasHub
      previewRole={previewRole}
      uiState={uiState}
      screen={screen}
      initialConflict={initialConflict}
      tplFilter={searchParams.filter}
      tplView={searchParams.view}
      tplQuery={searchParams.q}
    />
  );
}
