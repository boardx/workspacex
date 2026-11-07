"use client";
import { LanguageSwitcher } from "./language-switcher";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { Building2, FolderKanban, Lock, ShieldCheck } from "lucide-react";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { usePathname, useSearchParams } from "next/navigation";
import {
  isLocalOrg, LOCAL_ORG_GUARANTEES,
  selfHostedOnly,
  PROJECT_ROLES, type Identity, type ProjectRole,
} from "@/lib/identity";
import { resolveProjectContext, supportsProjectQuery } from "@/lib/project-context";
import { listProjects } from "@/lib/live-projects";
import { OrgMenu } from "./org-menu";
import { Button } from "@/components/ui/button";

/**
 * 项目路径、项目对话及带 projectId 的 Studio 内容页的项目显示名——`resolveProjectContext` 只解得出 `id`（见该文件
 * 头注释），这里补上「id → 人类可读名」这一步。用**已经真实挂了**的
 * `listProjects(orgId)`（F185 之后是去重扁平数组），不新开一个「按 id 查单个项目」的
 * 端点——本组件只是从组织的项目列表里找同一个 id 那一条，找不到（列表还没到、或这个
 * id 不在当前组织可见范围）时返回 null；Studio 不展示项目，项目路径/对话沿用「项目」占位。
 *
 * ⚠ 只在真实项目上下文内发请求——项目路径或带显式 projectId 的对话/Studio 内容页；不在独立工具页上
 *   为了「可能用得上」预取整个项目列表。
 */
/**
 * `useSearchParams()` 必须被包在自己的 `<Suspense>` 边界里——Next.js 静态导出对
 * 直接在页面渲染路径上调用它的客户端组件会拒绝预渲染（`missing-suspense-with-csr-bailout`）。
 * `TopBar` 是几乎每个页面共用的外壳，把整棵树都包进 Suspense 影响面太大，所以只把
 * 这一个纯读取查询串、不渲染任何东西的组件单独摘出来，外面套一层局部 Suspense。
 */
function ProjectIdFromSearchParams({ pathname, onChange }: {
  pathname: string;
  onChange: (value: { pathname: string; id: string | null }) => void;
}) {
  const searchParams = useSearchParams();
  const id = searchParams.get("projectId");
  React.useEffect(() => { onChange({ pathname, id }); }, [pathname, id, onChange]);
  return null;
}

function useProjectName(orgId: string, projectId: string | null): string | null {
  const [resolved, setResolved] = React.useState<{ orgId: string; projectId: string; name: string | null } | null>(null);
  React.useEffect(() => {
    if (!projectId) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    void listProjects(orgId)
      .then((items) => {
        if (cancelled) return;
        setResolved({ orgId, projectId, name: items.find((p) => p.id === projectId)?.name ?? null });
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId]);
  return resolved?.orgId === orgId && resolved.projectId === projectId ? resolved.name : null;
}

/**
 * 顶部条 = 组织切换器（裁决 O-12）+ 两层角色说明条（UC-0.3 R8）
 *
 * O-12 要点：切换器顶部常驻、会话内切换不需重新登录；
 * **切换时必须清空全部项目级上下文**（当前项目/环节/Context Pack/鉴权缓存/未提交草稿）。
 *
 * ⚠ **项目层身份与视角切换器只在项目上下文内渲染**（2026-07-28 修正）。
 *   此前无条件渲染「本项目：引导师」，等于宣称项目角色是全局属性——与 UC-0.3 冲突：
 *   项目角色只对某个**目标项目**成立，R4 E1 明写「有组织角色但无项目角色」是正常状态。
 *   在后台/任务/大脑上显示项目角色，是把一个不存在的判定画到界面上。
 *   作用域判定见 `lib/project-context.ts`。
 *
 * ⚠ 视角切换器是**预览手段，不是权限实现**，且生产构建不可达（verify-prod-gates.sh 断言）。
 *
 * ⚠ `hideRoleSwitcher`（2026-07-30）：**角色切换的唯一来源 = 各域内容区自带的切换器**。
 *   当本页内容区自带一个（如项目工作台的四视角切换器、问卷的 view-switcher）时，
 *   顶栏这个预览切换器**让位不渲染**，避免「同一页两套角色切换系统」。
 *   顶栏此时仍显示项目上下文标签（项目名·角色），只是不再出第二个切换器。
 *
 * ⚠ 组织管理入口 / 退出按钮（2026-08-09 信息架构调整）：**都已从顶栏挪走**。
 *   组织管理入口并入左上角组织菜单（见 `icon-rail.tsx` / `org-menu.tsx`）；
 *   退出并入左下角个人菜单（见 `personal-menu.tsx` 的 logout 菜单项）。
 *   顶栏不再单独持有这两者——同一功能不许两个入口。
 *
 * ⚠ 组织切换器（2026-08-11 信息架构调整）：**也从顶栏挪走了**——并入左上角组织菜单
 *   （`org-menu.tsx`，人类直接要求）。顶栏保留的组织名是**纯展示文本**
 *   （`topbar-org-name`），没有按钮态、不可点——不留看起来能点但不能点的东西。
 *   例外：<md 时 IconRail 整根隐藏，组织菜单会失去唯一入口，所以顶栏在 `md:hidden`
 *   下渲染同一个 `OrgMenu`（testid 加 `-mobile` 后缀防撞）。两个实例永远不同时可见，
 *   不构成第二入口。
 */
export function TopBar({
  identity, previewRole, hideRoleSwitcher, organizations, onSwitchOrganization, switching,
}: {
  identity: Identity;
  previewRole: ProjectRole | null;
  hideRoleSwitcher?: boolean;
  organizations: ReadonlyArray<{ id: string; label: string }>;
  onSwitchOrganization: (orgId: string) => void;
  switching?: boolean;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  // Query IDs only select a candidate. Studio context is visible only after the
  // current organization's authorized project list confirms it; no role comes from the query.
  const [projectIdParam, setProjectIdParam] = React.useState<{ pathname: string; id: string | null } | null>(null);
  const queryProjectId = projectIdParam?.pathname === pathname ? projectIdParam.id : null;
  const candidate = resolveProjectContext(pathname, queryProjectId);
  const projectName = useProjectName(identity.org.id, candidate?.id ?? null);
  const isStudioContext = supportsProjectQuery(pathname) && pathname !== "/chat";
  const project = isStudioContext && projectName === null ? null : candidate;
  const displayProject = project ? { ...project, name: projectName ?? t("ui.projects") } : null;
  const isDev = process.env.NODE_ENV !== "production";
  const projectLayer = project && !isStudioContext && identity.projectRole ? [t(`role.${identity.projectRole}`), identity.groupName].filter(Boolean).join(" · ") : null;
  // UC-0.5 R8：切到本地组织时整个应用要有**可感知**的状态变化——
  // 隐私模式若不可见，等于不存在。
  const local = isLocalOrg(identity.org);
  // UC-0.5 V12：同样是「只用自托管」，**承诺**与**策略**必须在界面上可分辨
  const sh = selfHostedOnly(identity.org);
  // 顶栏是否出自己的预览切换器：在项目上下文里、开发态、且本页没有自带一套
  const showOwnSwitcher = isDev && !!project && !isStudioContext && !hideRoleSwitcher;
  const currentOrgLabel =
    organizations.find((o) => o.id === identity.org.id)?.label ?? identity.org.name;
  // 2026-09-03 人类反馈：后台管理页（/admin、/platform-admin）自己的 AdminHeader 已经
  // 承担了身份展示（含 hideOrgIdentity 时的「平台运营」徽标，见该文件头注），顶栏这里
  // 再重复一遍「组织名 · 管理员」是同一信息的第二份展示，且对 /platform-admin 这类
  // 平台级页面而言字面上还是错的（顶栏永远显示当前登录所在的组织，与「平台」这个
  // 更高的作用域不是一回事）。两块后台都不需要顶栏的组织身份段。
  const isAdminRoute =
    pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/platform-admin" || pathname.startsWith("/platform-admin/");

  return (
    <header
      data-testid="shell-topbar"
      data-local-org={local ? "true" : undefined}
      className={[
        "flex h-11 shrink-0 items-center gap-3 border-b px-3 transition-colors duration-200",
        local ? "border-ai/30 bg-ai-tint" : "border-border bg-card",
      ].join(" ")}
    >
      {supportsProjectQuery(pathname) && (
        <React.Suspense fallback={null}>
          <ProjectIdFromSearchParams pathname={pathname} onChange={setProjectIdParam} />
        </React.Suspense>
      )}
      {/* ── 组织层：全局常驻 ── */}
      <div className="flex min-w-0 items-center gap-1.5">
        {/* <md 时 IconRail 隐藏，组织菜单（切换 + 组织管理）在这里补一个入口；≥md 由 rail 承担 */}
        <div className="shrink-0 md:hidden">
          <OrgMenu
            identity={identity}
            organizations={organizations}
            onSelect={onSwitchOrganization}
            switching={switching}
            placement="below"
            testIdSuffix="-mobile"
          />
        </div>
        {/*
          FB-2 —— <md 时 IconRail 隐藏，反馈入口在这里补一个；≥md 由 rail 承担。
          同 OrgMenu 的处置：小屏不丢入口，但也不在两处同时出现。
        */}
        <div className="shrink-0 md:hidden">
          <FeedbackButton
            target={{ kind: "product" }}
            targetLabel={null}
            testid="topbar-feedback"
            className="h-6 w-6"
          />
        </div>
        {!isAdminRoute && (local
          ? <Lock aria-hidden className="h-3.5 w-3.5 shrink-0 text-ai-tint-foreground" data-testid="topbar-local-lock" />
          : <Building2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />)}
        {!isAdminRoute && (
          <span data-testid="topbar-org-name" className="max-w-[12rem] truncate text-12 font-medium text-card-foreground">
            {currentOrgLabel}
          </span>
        )}
      </div>

      {!isAdminRoute && <div className="h-4 w-px shrink-0 bg-border" aria-hidden />}

      {!isAdminRoute && (
        <p data-testid="role-bar-org" className="min-w-0 flex-1 truncate text-12 text-muted-foreground">
          {[t(`role.${identity.orgRole}`), identity.org.team].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* ── 项目层：只在项目上下文里出现 ── */}
      {displayProject && (
        <>
          <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
          <div className="flex min-w-0 items-center gap-1.5" data-testid="topbar-project-context">
            <FolderKanban aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-12 font-medium">{displayProject.name}</span>
            {projectLayer && (
              <span data-testid="role-bar-project" className="truncate text-12 text-muted-foreground">
                · {projectLayer}
              </span>
            )}
          </div>
        </>
      )}

      {/* ── 视角切换器：预览手段，只在项目里、且本页未自带时出现；生产不可达 ── */}
      {showOwnSwitcher && (
        <div
          data-testid="role-preview-switcher"
          className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-panel p-1 lg:flex"
        >
          <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">{t("ui.projectPerspective")}</span>
          {PROJECT_ROLES.map((r) => (
            <Button key={r} asChild size="xs" variant={r === previewRole ? "primary" : "ghost"} data-testid={`role-switch-${r}`}>
              <a href={`?as=${r}`}>{t(`role.${r}`)}</a>
            </Button>
          ))}
        </div>
      )}

      {/* 本地模式常驻说明条 —— 三条硬隔离直接写在顶栏，不藏进设置里 */}
      {local && (
        <p
          data-testid="topbar-local-banner"
          data-guarantee-source="promise"
          title={LOCAL_ORG_GUARANTEES.map((g) => g.statement).join("；")}
          className="ml-auto hidden shrink-0 text-10 font-medium text-ai-tint-foreground lg:block"
        >
          {t("ui.localModeLocalModelsOnlyDataStaysOnThisDevice")}<span className="ml-1 text-muted-foreground">（{t("policy.promise")}）</span>
        </p>
      )}

      {/* 正式组织配了 self-hosted-only：同样限自托管，但它是**策略**不是承诺 —— 措辞与图标都要不同 */}
      {!local && sh.on && (
        <p
          data-testid="topbar-selfhosted-policy"
          data-guarantee-source="policy"
          title={t("policy.description")}
          className="ml-auto hidden shrink-0 items-center gap-1 text-10 font-medium text-accent-foreground lg:flex"
        >
          <ShieldCheck aria-hidden className="h-3 w-3" />
          {t("ui.thisOrganizationUsesSelfHostedModelsOnly")}<span className="text-muted-foreground">（{t("policy.policy")}）</span>
        </p>
      )}

      {/*
        不在项目里时给一句解释，而不是留白——「无项目角色」是正常状态，不是缺失。

        UI 评分 2026-08-23 第 10 项不一致③——旧文案「不在项目上下文中 · 项目角色不适用」
        与左侧 `role-bar-org`（`describeOrgLayer`）在组织角色恰好是「项目负责人」
        （`ORG_ROLE_LABEL.lead`，见 `lib/identity.ts`）时同屏并存，读起来像自相矛盾：
        一句说你是「项目负责人」，紧挨着一句说「项目角色不适用」。两者其实是两个不同的
        轴——组织角色（admin/lead/consultant/compliance，全局，与是否在某个具体项目里
        无关）vs 项目内角色（facilitator/groupLead/member/observer，只在项目里才有）——
        但共用「项目」这个字面词，普通用户看不出这层区分。改成明确列出项目内角色的名字，
        不再用「项目角色」这个会撞上「项目负责人」的泛称。
      */}
      {/*
        2026-08-23 人类实测反馈：这句提示在 `/chat`（尤其个人对话，默认落地屏）上
        纯属噪音——不在项目里本就是这个屏的常态，不需要每次都提醒。**只在 `/chat`
        隐藏**，其余非项目路由（如设置页）这句解释仍然保留，那些地方"为什么没有项目
        角色"确实需要说明。

        2026-08-24 人类截图实测反馈：`/admin/*` 后台管理界面同样不需要这句——后台
        本就不在任何具体项目里，这是它的常态而不是缺失，每个后台屏都重复提醒一遍
        纯属视觉噪音。同时排除 `/admin` 与 `/admin/`（用前缀匹配，覆盖
        `/admin/skill/[id]` 这类多段路由，不是只排除 `/admin` 这一段路径）。
        2026-09-02 后台切成两面后，平台后台 `/platform-admin/*` 同理排除。
      */}
      {!project && !local && !sh.on && pathname !== "/chat"
        && !["/research", "/itv", "/rec", "/studio/survey", "/projects"].includes(pathname)
        && !pathname.startsWith("/workflows")
        && pathname !== "/admin" && !pathname.startsWith("/admin/")
        && pathname !== "/platform-admin" && !pathname.startsWith("/platform-admin/") && (
        <p className="ml-auto hidden shrink-0 text-10 text-muted-foreground lg:block" data-testid="topbar-no-project-hint">
          {t("ui.outsideAProjectProjectRolesDoNotApply")}</p>
      )}

      <div className="ml-auto shrink-0"><LanguageSwitcher /></div>
    </header>
  );
}
