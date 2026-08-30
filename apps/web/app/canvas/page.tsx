import { redirect } from "next/navigation";
import { resolveCanvasScreen } from "@/lib/canvas-screens";

/**
 * `/canvas` 裸路由——历史 `?screen=` 查询参数式深链的**兼容重定向层**，不是内容页。
 *
 * ⚠ 2026-08-30 路由复盘（画布模板后台管理刷新掉回根目录一案）：屏切换是「换了一个
 * 完全不同的页面」，理应是路径段（Next.js App Router 推荐：不同视图 = 不同路径），
 * 而不是同一路径靠 query 切换。`/canvas/[screen]/page.tsx` 才是现在的规范落点——
 * `lib/mock/admin.ts` 的后台「画布模板」入口、`app/admin/[module]/page.tsx` 的
 * `canvasadmin` 重定向都已经直接指向那里。这里只做一件事：把仍可能存在的旧式
 * `/canvas?screen=template-admin`（历史书签、外部深链、别处忘了改的硬编码）
 * 307 到新路径，其余 query（state/as/conflict/filter/q）原样带过去，不吞任何参数。
 */
export default function CanvasLegacyQueryRoute({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const screen = resolveCanvasScreen(searchParams.screen);
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "screen") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined) qs.set(key, v);
  }
  const suffix = qs.toString();
  redirect(`/canvas/${screen}${suffix ? `?${suffix}` : ""}`);
}
