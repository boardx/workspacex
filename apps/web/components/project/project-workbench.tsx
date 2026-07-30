"use client";
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
 *   另有 Layout A（`/projects/[projectId]` 工作面清单）见 README 第六节「两版并存·待裁决」。
 *
 * 复用已确认的三栏骨架 AppShell（图标栏 + 组织切换顶栏）；工作台自身提供第二级
 * 项目头（‹全部项目 + 项目名 + 三类人 + Facilitator(AI)）、视角切换器、主标签、视角说明条。
 *
 * ⚠ 视角切换器是**预览手段，不是权限实现**：真实两层交集鉴权在服务端 NestJS Guard + RLS。
 *   `?as=` 只改本地展示（且四视角真的改变界面——观察者看到的显著更少）。
 * ⚠ 组织停用（`?orgState=disabled`）时全项目只读：显示只读原因条，不隐藏内容（uc-00-1 V12）。
 */
export function ProjectWorkbench({
  identity, uiState, tab, view, sub, orgDisabled = false, qs,
}: {
  identity: Identity;
  uiState: UiState;
  tab: ProjectTab;
  view: ProjectRole;
  sub: string | null;
  orgDisabled?: boolean;
  qs: { org?: string };
}) {
  const canWrite = ROLE_CAN_WRITE[view] && !orgDisabled;
  const stageControl = ROLE_STAGE_CONTROL[view] && !orgDisabled;
  const isObserver = view === "observer";

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
    <AppShell identity={identity} previewRole={null}>
      <div className="flex h-full min-h-0 flex-col bg-card" data-testid="project-workbench">
        {/* ── 项目头 ─────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-border px-6 pt-4">
          <div className="mb-3.5 flex flex-wrap items-start gap-3">
            <Button asChild size="sm" variant="outline" data-testid="project-back-to-list">
              <a href="/projects"><ChevronLeft aria-hidden className="h-3.5 w-3.5" />全部项目</a>
            </Button>
            <div className="min-w-0 flex-1">
              <div className="text-14 font-medium" data-testid="project-title">{PROJECT_HEADER.name}</div>
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
              {renderTab(tab, view, sub, orgDisabled)}
            </StateShell>
          </main>
        </div>
      </div>
    </AppShell>
  );
}

function renderTab(tab: ProjectTab, view: ProjectRole, _sub: string | null, orgDisabled: boolean) {
  switch (tab) {
    case "overview": return <TabOverview view={view} readOnly={orgDisabled} />;
    case "research": return <TabResearch view={view} readOnly={orgDisabled} />;
    case "prep": return <TabPrep view={view} readOnly={orgDisabled} />;
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
