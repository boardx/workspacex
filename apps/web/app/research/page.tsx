import { ResearchStudioApp } from "@/components/research-studio/research-studio-app";
import { mockIdentity } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveRsScreen, resolveRsView } from "@/lib/mock/research-studio";

/**
 * 研究 Studio（phase-01 契约束 `research` / M24）—— UI 先行原型。
 *
 * ⚠ 顶层路由 `/research`（并行安全）。**不是** `/studio/research`——那条已被 UC-0.2
 *   Context Pack 占用（`navigation.ts` 的 `ucRefs` 逐字 `00-core/uc-0-2`）。二者语义不同，
 *   共用一条路由是 `requirements/24-research/OPEN-QUESTIONS.md` 的 Q-2（阻塞级，未裁）。
 *   本原型另起路由并把冲突写进 `ui-preview/research/README.md`，等人类裁 Q-2。
 *
 * ⚠ 服务端组件：只解析 URL + 组装身份，把可序列化 props 交给客户端 App。
 *   真实权限在服务端（NestJS Guard + PostgreSQL RLS）；`?as=` / `?state=` / `?screen=` / `?sub=`
 *   只是预览手段，生产构建不可达。
 */
export default function ResearchPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; screen?: string; sub?: string; org?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const view = resolveRsView(searchParams.as);
  const screen = resolveRsScreen(searchParams.screen);
  // 研究成员模型是 owner/collaborator（U-1 B），与项目四角色无关；身份用组织层即可。
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", null);

  return (
    <ResearchStudioApp
      identity={identity}
      uiState={uiState}
      screen={screen}
      view={view}
      sub={searchParams.sub}
      qs={{ as: searchParams.as }}
    />
  );
}
