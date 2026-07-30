import { redirect } from "next/navigation";

/**
 * ⚠ 已退役（2026-07-30）——见同级 `../page.tsx`。访谈详情的现行实现在 v2 束 `/itv`
 * （`?screen=…` 承接研究设计 / 现场 / 洞察）。旧详情屏 `components/interview/*` 保留留痕，
 * 不再有入口。任何残留深链（含 `/studio/interview/new`）永久重定向到现行束路由。
 */
export default function DeprecatedInterviewDetailPage() {
  redirect("/itv");
}
