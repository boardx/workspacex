import { redirect } from "next/navigation";

/**
 * 旧路由 `/admin/agent/[id]` → `/platform-admin/agent/[id]`（2026-09-02 第二次裁决：AI 能力
 * 归平台后台，见 `lib/mock/admin.ts` AI 能力组注）。保留重定向、透传查询串（`?from=` 等），
 * 不留死链；页面本体已搬到 `app/platform-admin/agent/[id]/page.tsx`。
 */
export default function LegacyAgentEditRedirect({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) for (const item of v) qs.append(k, item);
  }
  const query = qs.toString();
  redirect(`/platform-admin/agent/${encodeURIComponent(params.id)}${query ? `?${query}` : ""}`);
}
