import { ProjectWorkbench } from "@/components/project/project-workbench";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveProjectTab } from "@/lib/mock/project";

/**
 * 项目主页 `/projects/[projectId]` —— project 束现行落点（2026-08-02，issue #317 收敛）。
 *
 * 这里此前是 2026-07-28 补的简易「枢纽页」（只有一排工作面卡片链接，无 tab）——
 * 当时是为了先堵住「进入项目」死按钮这个真缺口。但同一时间仓库里已经长出了一个更完整、
 * 匹配签核设计材料（`ui-preview/project-v2/`）的六 tab 工作台 `ProjectWorkbench`，
 * 却挂在**静态**路由 `/project`（无 `[projectId]` 参数），从未被列表卡片的「进入项目」
 * 链接过——两个实现各自长出来，没人接上（同一类漂移见 `/studio/interview`→`/itv`）。
 *
 * 处置（详见 `project-workbench.tsx` 头注「路由收敛」一节）：
 *   · 六 tab 工作台迁到本路由，按 `params.projectId` 参数化（沿用 `canvas`/`files`
 *     子路由已建立的模式：解析 URL、组装身份，把可序列化 props 交给客户端组件）；
 *   · 旧枢纽页的「工作面」清单折入工作台「概览」tab（`tab-overview.tsx`），
 *     `现场大屏尚未建` 的显式禁用状态原样保留，不静默丢弃；
 *   · 静态 `/project` 退役为 `redirect("/projects")` 桩。
 *
 * ⚠ 与 `canvas`/`files` 子路由同型的已知 mock 债：六个 tab 里除「概览」的项目基本
 *   信息块外，内部的具体内容仍是单一 mock 场景（`lib/mock/project.ts` 的
 *   `PROJECT_HEADER` 等），不因不同项目 id 而不同——这次（F353）只接「概览」。
 *
 * ⚠ F353：项目名称/kind/status/只读原因改由 `ProjectWorkbench` 内部真实拉取
 *   （`GET /projects?orgId=`，按 id 在 member/managed 两段里找），不再用
 *   `MOCK_PROJECTS.find(...)` 编。真实拉取需要 `orgId`——契约没有「按 id 直接读
 *   单个项目」的已挂路由（`getProjectOverview` 在契约与应用层都有，但控制器从未
 *   挂那个 `@Get`，见 `lib/live-projects.ts` `findProject` 头注的缺口报告），
 *   所以这里退化成从 `?org=` 读（`/projects` 列表页的「进入项目」链接会带上它）。
 *   没有 `?org=` 或未登录时，工作台照旧显示 mock 头像信息，不假装有真实数据。
 */
export default function ProjectHomePage({
  params, searchParams,
}: {
  params: { projectId: string };
  searchParams: { state?: string; as?: string; org?: string; tab?: string; sub?: string; orgState?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const view = resolvePreviewRole(searchParams.as) ?? "facilitator";
  const tab = resolveProjectTab(searchParams.tab);
  const sub = typeof searchParams.sub === "string" ? searchParams.sub : null;
  const orgDisabled = process.env.NODE_ENV !== "production" && searchParams.orgState === "disabled";
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", view);

  return (
    <ProjectWorkbench
      identity={identity}
      uiState={uiState}
      tab={tab}
      view={view}
      sub={sub}
      orgDisabled={orgDisabled}
      qs={{ org: searchParams.org }}
      projectId={params.projectId}
    />
  );
}
