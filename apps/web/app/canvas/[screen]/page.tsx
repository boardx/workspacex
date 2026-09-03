import { notFound } from "next/navigation";
import { CanvasHub } from "@/components/canvas/canvas-hub";
import { resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { CANVAS_SCREENS, isCanvasScreen } from "@/lib/canvas-screens";

/**
 * canvas 能力域 hub（规范路由 `/canvas/[screen]`，六屏各占一个路径段）。
 *
 * ⚠ 2026-08-30 路由复盘（画布模板后台管理刷新掉回根目录一案）：此前六屏共享
 * 裸路径 `/canvas`，靠 `?screen=` 切换——Next.js App Router 推荐「不同视图 =
 * 不同路径段」，query 只表达同一视图内的正交状态。屏 id 不认识时这里 `notFound()`
 * （不像历史兼容层 `app/canvas/page.tsx` 那样回落到默认屏——那是专门迁就可能过期
 * 的外部书签，本体不该继承那份宽容）。历史 `/canvas?screen=…` 深链经
 * `app/canvas/page.tsx` 307 到这里，query 参数原样带过来。
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
export function generateStaticParams() {
  return CANVAS_SCREENS.map((s) => ({ screen: s.id }));
}

export default function CanvasScreenPage({
  params, searchParams,
}: {
  params: { screen: string };
  searchParams: {
    state?: string; as?: string; conflict?: string;
    /** #9（2026-08-22）：`template-admin` 屏筛选/视图/搜索词——只有该屏读它们。 */
    filter?: string; view?: string; q?: string;
    /** 排序档位——同上，只有 `template-admin` 屏读它，见 `template-admin.tsx` 的 `SortBy`。 */
    sort?: string;
  };
}) {
  if (!isCanvasScreen(params.screen)) notFound();

  const uiState = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const initialConflict = searchParams.conflict === "on" || searchParams.conflict === "1";

  return (
    <CanvasHub
      previewRole={previewRole}
      uiState={uiState}
      screen={params.screen}
      initialConflict={initialConflict}
      tplFilter={searchParams.filter}
      tplQuery={searchParams.q}
      tplSort={searchParams.sort}
    />
  );
}
