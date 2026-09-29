import { redirect } from "next/navigation";

/**
 * ⚠ 已退役为生产路由——研究能力域的**现行**实现是顶层 `/research`（导航「研究」指向它）。
 *
 * 本路由此前渲染 UC-0.2 Context Pack 的 UI 先行原型：整屏 `lib/mock/research.ts`
 * （远洋新能源、固定模型名……），没有任何真实数据源，却能被真实用户直接打开。
 * Context Pack 与研究 Studio 的 IA 归并（`requirements/24-research/OPEN-QUESTIONS.md` Q-2）
 * 仍待人类裁决，所以原型不删：搬到 UI 先行原型命名空间 `/preview/context-pack`
 * （`ui-wiring-manifest.json` 的 `previewPrefixes`），本路由永久重定向到现行屏。
 */
export default function RetiredContextPackStudioPage() {
  redirect("/research");
}
