"use client";
import * as React from "react";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import { OrgDisabledBanner } from "./parts";
import { UI_STATES, UI_STATE_LABEL, type UiState } from "@/lib/ui-state";
import type { Identity } from "@/lib/identity";
import {
  TAB_DEFS, TAB_LABEL, SUB_NAV, ROLE_SCOPE_NOTE, ROLE_CAN_WRITE, ROLE_STAGE_CONTROL,
  ROLE_BADGE_TONE, PROJECT_HEADER, PROJECT_ROLE_LABEL, PROJECT_ROLES, PROJECT_TABS,
  ORG_DISABLED_BANNER, type ProjectTab, type ProjectRole,
} from "@/lib/mock/project";
import { getStoredSessionToken, ApiError } from "@/lib/api-client";
import {
  findProject, getProjectOverview, listAgendaSegments,
  type ProjectListItem, type ProjectOverview, type ListAgendaSegmentsOut,
} from "@/lib/live-projects";
import {
  getProjectTopic, getProjectGrouping,
  type ProjectTopicOut, type ProjectGroupingOut,
} from "@/lib/live-project-prep";
import { TabOverview } from "./tab-overview";
import { TabLive } from "./tab-live";
import { TabResults } from "./tab-results";
import { TabTodo } from "./tab-todo";
import { TabResearch } from "./tab-research";
import { TabPrep } from "./tab-prep";
import { TabSettings } from "./tab-settings";

/**
 * 项目工作台（project 域主编排 · Layout B / 原型 wsDetailView 的 React 转译）。
 *
 * ⚠ 原型证据（byte offset）：项目列表卡片「进入项目」按钮 → `openWs`（byte 15169552 区）
 *   → 本工作台，顶部是**阶段式** tab（isWsOver@15221492 / isWsRov@15277095 /
 *   isWsScope@15348094 / isWsAgenda@15368783 / isWsDuring@15401543 / isWsAfter@15500356 /
 *   isWsTodo@15530664 + isSetup）。这是静态原型里项目空间的**权威**布局。
 *
 * ── 路由收敛（2026-08-02，issue #317）──────────────────────────────────
 * 原 Layout A（`/projects/[projectId]` 工作面清单）与本工作台（当时挂在静态 `/project`，
 * 无 `[projectId]` 参数）曾是「两版并存·待裁决」（`ui.md` A-0，见 ui-preview/project-v2/README.md
 * 第四节）。列表卡片「进入项目」实际链接的是 `/projects/${id}`，从未接到过 `/project`——
 * 与已修过的 `/studio/interview`→`/itv`、`/studio/prototype`→`/canvas` 同一类漂移。
 * 处置：本工作台迁到 `/projects/[projectId]`（唯一落点），按 `params.projectId` 接收
 * `projectId`/`projectName`；Layout A 的工作面清单折入「概览」tab（见 `tab-overview.tsx`
 * `PROJECT_SURFACES`），不静默丢弃「现场大屏尚未建」这条诚实信息。静态 `/project` 退役为
 * `redirect("/projects")` 桩。A-0 本身仍是设计签核材料里登记的待裁决项，这次处置是
 * issue #317（人类直接拍板）的落地，不是 agent 自行改签核状态。
 *
 * 复用已确认的三栏骨架 AppShell（图标栏 + 组织切换顶栏）；工作台自身提供第二级
 * 项目头（‹全部项目 + 项目名 + 三类人 + Facilitator(AI)）、视角切换器、主标签、视角说明条。
 *
 * ⚠ 视角切换器是**预览手段，不是权限实现**：真实两层交集鉴权在服务端 NestJS Guard + RLS。
 *   `?as=` 只改本地展示（且四视角真的改变界面——观察者看到的显著更少）。
 * ⚠ 组织停用（`?orgState=disabled`）时全项目只读：显示只读原因条，不隐藏内容（uc-00-1 V12）。
 */
export function ProjectWorkbench({
  identity, uiState, tab, view, sub, orgDisabled = false, qs, projectId,
}: {
  /**
   * issue #1316：不再由页面层拼一份 mock 身份——省略时 `AppShell` 落到
   * `SessionProvider` 解析出的真实会话身份（同 `/projects` 列表页的路径）。
   * 只有 `ui-preview/project-v2/` 之类的原型/签核材料路由才该显式传一个假身份。
   */
  identity?: Identity;
  uiState: UiState;
  tab: ProjectTab;
  view: ProjectRole;
  sub: string | null;
  orgDisabled?: boolean;
  qs: { org?: string };
  /**
   * 真实项目标识（F317：路由从静态 `/project` 迁到 `/projects/[projectId]` 后，
   * 由页面层传入 `params.projectId`）。用于跳转「工作面」子屏（canvas/files）、
   * 以及（F353）拉取真实项目基本信息；其余各 tab 的内容仍是单一 mock 场景
   * （`PROJECT_HEADER` 等），**不按项目区分**——与 `canvas`/`files` 页面同型的
   * 已知 mock 债，不在本次范围内补齐。
   */
  projectId?: string;
}) {
  const canWrite = ROLE_CAN_WRITE[view] && !orgDisabled;
  const stageControl = ROLE_STAGE_CONTROL[view] && !orgDisabled;
  const isObserver = view === "observer";

  /**
   * F353 —— 真实项目基本信息（id/name/kind/status/readOnlyReason）。
   *
   * 需要 `orgId` 才能查（契约没有「按 id 直接读单个项目」的已挂路由，见
   * `lib/live-projects.ts` `findProject` 头注）。没有 `qs.org` 或没登录时
   * 保持 `null`——`TabOverview`/页头据此显示诚实的「暂无真实数据」而不是空转。
   */
  const [liveProject, setLiveProject] = React.useState<ProjectListItem | null>(null);
  const [liveLoading, setLiveLoading] = React.useState(false);
  const [liveError, setLiveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!projectId || !qs.org) {
      setLiveProject(null);
      setLiveError(null);
      return;
    }
    const token = getStoredSessionToken();
    if (!token) {
      setLiveProject(null);
      setLiveError(null);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);
    findProject(qs.org, projectId)
      .then((p) => {
        if (!cancelled) setLiveProject(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLiveError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
        }
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, qs.org]);

  /**
   * F362 —— 概览 tab 专用的真实 overview（`currentAgendaSegment`/`roleCounts`/
   * `backflow`/`blueprint`）。只在「概览」tab 激活时拉取，且不需要 `qs.org`
   * （`getProjectOverview` 的 `orgId` 在服务端取自 principal）——与上面
   * `findProject` 那次拉取（供项目头 name/kind/status/readOnlyReason 用）是
   * 两次独立的请求，范围各自成立，互不替代。
   */
  const [liveOverview, setLiveOverview] = React.useState<ProjectOverview | null>(null);
  const [liveOverviewLoading, setLiveOverviewLoading] = React.useState(false);
  const [liveOverviewError, setLiveOverviewError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!projectId || tab !== "overview") {
      setLiveOverview(null);
      setLiveOverviewError(null);
      return;
    }
    const token = getStoredSessionToken();
    if (!token) {
      setLiveOverview(null);
      setLiveOverviewError(null);
      return;
    }
    let cancelled = false;
    setLiveOverviewLoading(true);
    setLiveOverviewError(null);
    getProjectOverview(projectId)
      .then((o) => {
        if (!cancelled) setLiveOverview(o);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLiveOverviewError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
        }
      })
      .finally(() => {
        if (!cancelled) setLiveOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, tab]);

  /**
   * #853 —— 项目筹备 tab 专用的真实议程环节列表（`GET /workshops/:workshopId/
   * agenda-segments`，F853 补的 `listAgendaSegments`）。同 F362 那次 `liveOverview`
   * 的取法：只在「筹备」tab 激活时拉取，不需要 `qs.org`（`orgId` 服务端取自
   * principal）。`refreshSegments` 单独导出给 `TabPrep`：新建一条环节成功后**重新
   * 打一次这个真实 GET**，不在本地把新行 append 进 state——那是本仓一贯的纪律
   * （同 `template-apply-dialog.tsx` 对 `onApplied` 的注释）。
   */
  const [liveSegments, setLiveSegments] = React.useState<ListAgendaSegmentsOut | null>(null);
  const [liveSegmentsLoading, setLiveSegmentsLoading] = React.useState(false);
  const [liveSegmentsError, setLiveSegmentsError] = React.useState<string | null>(null);

  const refreshSegments = React.useCallback(() => {
    if (!projectId) return;
    if (!getStoredSessionToken()) return;
    setLiveSegmentsLoading(true);
    setLiveSegmentsError(null);
    listAgendaSegments(projectId)
      .then((rows) => setLiveSegments(rows))
      .catch((e: unknown) => {
        setLiveSegmentsError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
      })
      .finally(() => setLiveSegmentsLoading(false));
  }, [projectId]);

  React.useEffect(() => {
    if (!projectId || tab !== "prep") {
      setLiveSegments(null);
      setLiveSegmentsError(null);
      return;
    }
    if (!getStoredSessionToken()) {
      setLiveSegments(null);
      setLiveSegmentsError(null);
      return;
    }
    refreshSegments();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshSegments 只依赖 projectId，随它一起重建
  }, [projectId, tab]);

  /**
   * F950（2026-08-16 delta）—— 项目筹备 tab 的定题/分组，与上面 `liveSegments` 同一套
   * 取法：只在「筹备」tab 激活时拉取；`refreshTopic`/`refreshGrouping` 单独导出给
   * `TabPrep`，保存成功后重新打一次真实 GET，不在本地拼接乐观更新的值。
   */
  const [liveTopic, setLiveTopic] = React.useState<ProjectTopicOut | null>(null);
  const [liveTopicLoading, setLiveTopicLoading] = React.useState(false);
  const [liveTopicError, setLiveTopicError] = React.useState<string | null>(null);

  const refreshTopic = React.useCallback(() => {
    if (!projectId) return;
    if (!getStoredSessionToken()) return;
    setLiveTopicLoading(true);
    setLiveTopicError(null);
    getProjectTopic(projectId)
      .then((row) => setLiveTopic(row))
      .catch((e: unknown) => {
        setLiveTopicError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
      })
      .finally(() => setLiveTopicLoading(false));
  }, [projectId]);

  const [liveGrouping, setLiveGrouping] = React.useState<ProjectGroupingOut | null>(null);
  const [liveGroupingLoading, setLiveGroupingLoading] = React.useState(false);
  const [liveGroupingError, setLiveGroupingError] = React.useState<string | null>(null);

  const refreshGrouping = React.useCallback(() => {
    if (!projectId) return;
    if (!getStoredSessionToken()) return;
    setLiveGroupingLoading(true);
    setLiveGroupingError(null);
    getProjectGrouping(projectId)
      .then((row) => setLiveGrouping(row))
      .catch((e: unknown) => {
        setLiveGroupingError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
      })
      .finally(() => setLiveGroupingLoading(false));
  }, [projectId]);

  React.useEffect(() => {
    if (!projectId || tab !== "prep" || !getStoredSessionToken()) {
      setLiveTopic(null);
      setLiveTopicError(null);
      setLiveGrouping(null);
      setLiveGroupingError(null);
      return;
    }
    refreshTopic();
    refreshGrouping();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 两者只依赖 projectId，随它一起重建
  }, [projectId, tab]);

  const href = (o: Partial<{ tab: string; as: string; state: string; sub: string }>) => {
    const p = new URLSearchParams();
    if (qs.org) p.set("org", qs.org);
    if (orgDisabled) p.set("orgState", "disabled");
    const t = o.tab ?? tab; if (t && t !== "overview") p.set("tab", t);
    const as = o.as ?? view; if (as) p.set("as", as);
    const st = o.state ?? uiState; if (st && st !== "default") p.set("state", st);
    const sb = "sub" in o ? o.sub : sub; if (sb) p.set("sub", sb);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  const subNav = SUB_NAV[tab];

  return (
    // hideRoleSwitcher：工作台自带四视角切换器（project-role-switcher），顶栏让位不再出第二套
    <AppShell identity={identity} previewRole={null} hideRoleSwitcher>
      <div className="flex h-full min-h-0 flex-col bg-card" data-testid="project-workbench">
        {/* ── 项目头 ─────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-border px-6 pt-4">
          <div className="mb-3.5 flex flex-wrap items-start gap-3">
            <Button asChild size="sm" variant="outline" data-testid="project-back-to-list">
              <a href="/projects"><ChevronLeft aria-hidden className="h-3.5 w-3.5" />全部项目</a>
            </Button>
            <div className="min-w-0 flex-1">
              <div className="text-14 font-medium" data-testid="project-title">{liveProject?.name ?? PROJECT_HEADER.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-11 text-muted-foreground">
                  {PROJECT_HEADER.org} · {PROJECT_HEADER.duration} · {PROJECT_HEADER.groupCount}
                </span>
                <Badge tone="outline">引导师 {PROJECT_HEADER.facilitatorName}</Badge>
                <Badge tone="outline">项目经理 {PROJECT_HEADER.managerName}</Badge>
                <Badge tone="outline">参与者 {PROJECT_HEADER.participantCount}</Badge>
                <Badge tone="ai" data-testid="project-ai-facilitator">{PROJECT_HEADER.aiFacilitator}</Badge>
              </div>
            </div>

            {/* 视角切换器（四档）—— 预览手段，生产不可达在 page 层控制 */}
            <div
              data-testid="project-role-switcher"
              className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border-subtle bg-panel p-1"
            >
              <span className="px-1.5 font-mono text-9 uppercase tracking-wider text-muted-foreground">视角</span>
              {PROJECT_ROLES.map((r) => (
                <Button key={r} asChild size="xs" variant={r === view ? "primary" : "ghost"} className="transition-colors" data-testid={`project-role-${r}`}>
                  <a href={href({ as: r })}>{PROJECT_ROLE_LABEL[r]}</a>
                </Button>
              ))}
            </div>

            {/* 角色相关动作（组长/组员有；观察者无——只读；组织停用时也隐藏） */}
            {view === "groupLead" && canWrite && (
              <Button size="sm" variant="primary" data-testid="project-submit-group">提交本组产出</Button>
            )}
            {view === "member" && canWrite && (
              <Button size="sm" variant="outline" data-testid="project-raise-hand">举手</Button>
            )}
          </div>

          {/* ── 主标签 ─────────────────────────────────────── */}
          <nav className="flex gap-1 overflow-x-auto" data-testid="project-tabs" aria-label="项目标签">
            {TAB_DEFS.map((t) => {
              const active = t.key === tab;
              return (
                <a
                  key={t.key}
                  href={href({ tab: t.key, sub: undefined })}
                  data-testid={`project-tab-${t.key}`}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-13 font-medium transition-colors",
                    active ? "border-primary text-background-foreground" : "border-transparent text-muted-foreground hover:text-background-foreground",
                    t.key === "settings" ? "ml-auto" : "",
                  ].join(" ")}
                >
                  {t.label}
                  {t.badge && (
                    <span className={[
                      "grid min-w-4 place-items-center rounded-full px-1 font-mono text-9",
                      t.badgeTone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
                    ].join(" ")}>{t.badge}</span>
                  )}
                </a>
              );
            })}
          </nav>

          {/* ── 视角说明条 ─────────────────────────────────── */}
          <div
            data-testid="project-role-scope-note"
            className="-mx-6 mt-0 flex flex-wrap items-center gap-2.5 border-t border-border bg-panel px-6 py-2"
          >
            <Badge tone={ROLE_BADGE_TONE[view]} data-testid="project-role-badge">{PROJECT_ROLE_LABEL[view]} 视角</Badge>
            <span className="min-w-0 flex-1 text-11 leading-relaxed text-muted-foreground">{ROLE_SCOPE_NOTE[view]}</span>
            {canWrite
              ? <span className="shrink-0 font-mono text-9 text-success" data-testid="project-scope-can-write">可发言</span>
              : <span className="shrink-0 font-mono text-9 text-muted-foreground" data-testid="project-scope-readonly">只读</span>}
            {stageControl && <span className="shrink-0 font-mono text-9 text-primary" data-testid="project-scope-stage-control">全场控制</span>}
          </div>
        </div>

        {/* ── 预览调试条（仅 dev） ───────────────────────────── */}
        <PreviewBar href={href} uiState={uiState} tab={tab} view={view} orgDisabled={orgDisabled} qs={qs} />

        {/* ── 主体：可选左子导航 + 内容 ─────────────────────── */}
        <div className="flex min-h-0 flex-1">
          {subNav && (
            <aside className="hidden w-48 shrink-0 flex-col gap-0.5 border-r border-border bg-panel p-3 md:flex" data-testid="project-sub-nav">
              <span className="px-2 pb-2 text-10 font-medium uppercase tracking-wide text-muted-foreground">{subNav.section}</span>
              {subNav.items.map((it, i) => {
                const active = sub ? sub === it.key : i === 0;
                return (
                  <a
                    key={it.key}
                    href={href({ sub: it.key })}
                    data-testid={`project-subnav-${it.key}`}
                    aria-current={active ? "true" : undefined}
                    className={[
                      "flex items-center gap-2 rounded-md px-2.5 py-2 text-12 transition-colors",
                      active ? "bg-card font-medium text-background-foreground shadow-sm" : "text-muted-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.meta && (
                      <span className={[
                        "shrink-0 font-mono text-9",
                        it.metaTone === "success" ? "text-success" : it.metaTone === "danger" ? "text-destructive" : "text-muted-foreground",
                      ].join(" ")}>{it.meta}</span>
                    )}
                  </a>
                );
              })}
            </aside>
          )}

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="project-main">
            {orgDisabled && (
              <div className="p-6 pb-0">
                <OrgDisabledBanner {...ORG_DISABLED_BANNER} />
              </div>
            )}
            <StateShell
              state={uiState}
              className="p-6"
              emptyHint={`${TAB_LABEL[tab]}还没有内容——套用蓝本或从空白开始后，这里才会有结构。`}
              errors={{ 发布范围: "发布结论前必须绑定一个确定的产出版本（不能绑草稿）" }}
              depFailure={{ what: "转写 / 知识图谱服务暂时不可用；已排队，恢复后自动补齐。" }}
              denial={{
                layer: "project",
                reason: isObserver
                  ? "观察者只读：原始转写、私聊与操作按钮不在你的授权范围内。"
                  : "你在本项目中没有查看这块内容的项目角色（两层交集判定在服务端执行）。",
              }}
              successMessage="已发布 · 绑定 v2，审计已留痕"
            >
              {renderTab(
                tab, view, sub, orgDisabled, projectId ?? PROJECT_HEADER.id,
                liveProject, liveLoading, liveError,
                liveOverview, liveOverviewLoading, liveOverviewError,
                liveSegments, liveSegmentsLoading, liveSegmentsError, refreshSegments,
                liveTopic, liveTopicLoading, liveTopicError, refreshTopic,
                liveGrouping, liveGroupingLoading, liveGroupingError, refreshGrouping,
              )}
            </StateShell>
          </main>
        </div>
      </div>
    </AppShell>
  );
}

function renderTab(
  tab: ProjectTab,
  view: ProjectRole,
  _sub: string | null,
  orgDisabled: boolean,
  projectId: string,
  liveProject: ProjectListItem | null,
  liveLoading: boolean,
  liveError: string | null,
  liveOverview: ProjectOverview | null,
  liveOverviewLoading: boolean,
  liveOverviewError: string | null,
  liveSegments: ListAgendaSegmentsOut | null,
  liveSegmentsLoading: boolean,
  liveSegmentsError: string | null,
  refreshSegments: () => void,
  liveTopic: ProjectTopicOut | null,
  liveTopicLoading: boolean,
  liveTopicError: string | null,
  refreshTopic: () => void,
  liveGrouping: ProjectGroupingOut | null,
  liveGroupingLoading: boolean,
  liveGroupingError: string | null,
  refreshGrouping: () => void,
) {
  switch (tab) {
    case "overview":
      return (
        <TabOverview
          view={view}
          readOnly={orgDisabled}
          projectId={projectId}
          liveProject={liveProject}
          liveLoading={liveLoading}
          liveError={liveError}
          liveOverview={liveOverview}
          liveOverviewLoading={liveOverviewLoading}
          liveOverviewError={liveOverviewError}
        />
      );
    case "research": return <TabResearch view={view} readOnly={orgDisabled} />;
    case "prep":
      return (
        <TabPrep
          view={view}
          readOnly={orgDisabled}
          projectId={projectId}
          liveProject={liveProject}
          liveSegments={liveSegments}
          liveSegmentsLoading={liveSegmentsLoading}
          liveSegmentsError={liveSegmentsError}
          onSegmentCreated={refreshSegments}
          liveTopic={liveTopic}
          liveTopicLoading={liveTopicLoading}
          liveTopicError={liveTopicError}
          onTopicSaved={refreshTopic}
          liveGrouping={liveGrouping}
          liveGroupingLoading={liveGroupingLoading}
          liveGroupingError={liveGroupingError}
          onGroupingSaved={refreshGrouping}
        />
      );
    case "live": return <TabLive view={view} readOnly={orgDisabled} />;
    case "results": return <TabResults view={view} readOnly={orgDisabled} />;
    case "todo": return <TabTodo view={view} readOnly={orgDisabled} />;
    case "settings": return <TabSettings view={view} readOnly={orgDisabled} />;
  }
}

/** 仅开发/预览环境的调试切换条（生产构建不渲染，UC-0.4 R9 / R12 V8）*/
function PreviewBar({
  href, uiState, tab, view, orgDisabled, qs,
}: {
  href: (o: Partial<{ tab: string; as: string; state: string; sub: string }>) => string;
  uiState: UiState;
  tab: ProjectTab;
  view: ProjectRole;
  orgDisabled: boolean;
  qs: { org?: string };
}) {
  if (process.env.NODE_ENV === "production") return null;
  // 组织停用开关：拼一个反转 orgState 的链接
  const toggleOrgHref = (() => {
    const p = new URLSearchParams();
    if (qs.org) p.set("org", qs.org);
    if (!orgDisabled) p.set("orgState", "disabled");
    if (tab !== "overview") p.set("tab", tab);
    if (view) p.set("as", view);
    if (uiState !== "default") p.set("state", uiState);
    const s = p.toString();
    return s ? `?${s}` : "?";
  })();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-panel-alt px-6 py-1.5" data-testid="project-preview-bar">
      <span className="font-mono text-9 uppercase tracking-wider text-muted-foreground">七态</span>
      {UI_STATES.map((s) => (
        <Button key={s} asChild size="xs" variant={s === uiState ? "primary" : "ghost"} className="transition-colors" data-testid={`project-preview-state-${s}`}>
          <a href={href({ state: s })}>{UI_STATE_LABEL[s]}</a>
        </Button>
      ))}
      <span className="ml-2 font-mono text-9 uppercase tracking-wider text-muted-foreground">屏</span>
      {PROJECT_TABS.map((t) => (
        <Button key={t} asChild size="xs" variant={t === tab ? "primary" : "ghost"} className="transition-colors" data-testid={`project-preview-tab-${t}`}>
          <a href={href({ tab: t, sub: undefined })}>{TAB_LABEL[t]}</a>
        </Button>
      ))}
      <Button asChild size="xs" variant={orgDisabled ? "primary" : "ghost"} className="ml-2 transition-colors" data-testid="project-preview-orgdisabled">
        <a href={toggleOrgHref}>组织停用</a>
      </Button>
      <span className="font-mono text-9 text-muted-foreground">· 当前 {view}</span>
    </div>
  );
}
