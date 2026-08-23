"use client";
import * as React from "react";
import Link from "next/link";
import { Search, Plus, MoreHorizontal, AlertTriangle, LayoutGrid, List as ListIcon, X, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/session/session-provider";
import {
  PROJECT_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_TAGS_MAX,
  archiveProject,
  listProjects,
  unarchiveProject,
  updateProjectTags,
  type ProjectListItem,
} from "@/lib/live-projects";

const VIEW_MODE_STORAGE_KEY = "projects-view-mode";
type ViewMode = "card" | "list";

/**
 * 项目列表主体（F353 从 mock 切到真实数据 → F185 2026-08-16 delta：去掉「我在里面/
 * 我管着它」两段式分组，改扁平列表 + tags + 卡片/列表视图切换）。
 *
 * ⚠ 为什么不是「保留原型卡片，只换数据源」：契约 `ProjectListItem` 只有六个字段
 * （id/name/kind/status/readOnlyReason/tags），原型卡片（`ProjectSummary`，见
 * `lib/mock/projects.ts`）画的 `readiness`/`stageProgress`/`schedule`/`owner`/
 * `priority` 全部**没有出处**。这次按 F185 的裁决把两段式改成扁平数组，
 * 原有的「我在里面」「我管着它」分组文案随之整体去掉——不是漏画，是契约层面
 * 已经不再区分（见 `requirements/00-project/OPEN-QUESTIONS.md` 「🔁 2026-08-16 delta」）。
 *
 * 视图模式（卡片/列表）是纯前端展示偏好，存 `localStorage`，不是契约字段，不写回后端。
 * 标签筛选同理：响应体只带 `tags: string[]`，筛不筛、怎么筛是 UI 决定（usecases.md
 * UC-P2「分区是展示决定不是响应体决定」原文延续到 tags 上）。
 *
 * `orgId` 来自根级 SessionProvider 已解析的真实 current-org，不再由用户手填，也不在
 * 项目页内重复维护第二套登录状态。
 */
export function ProjectsScreen() {
  const { session } = useSession();
  if (!session) throw new Error("ProjectsScreen requires an authenticated session");
  const orgId = session.currentOrgId;

  const [projects, setProjects] = React.useState<ProjectListItem[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listBusy, setListBusy] = React.useState(false);

  const [query, setQuery] = React.useState("");
  const [activeTags, setActiveTags] = React.useState<readonly string[]>([]);

  const [viewMode, setViewMode] = React.useState<ViewMode>("card");
  React.useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "card" || stored === "list") setViewMode(stored);
  }, []);
  const setView = (mode: ViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  };

  const refresh = React.useCallback(async (org: string) => {
    if (org === "") return;
    setListBusy(true);
    setListError(null);
    try {
      const out = await listProjects(org);
      setProjects([...out]);
    } catch (e) {
      setListError(describeError(e));
      setProjects(null);
    } finally {
      setListBusy(false);
    }
  }, []);

  // current-org changes only through the signed switch operation; each change reloads this list.
  React.useEffect(() => {
    setProjects(null);
    void refresh(orgId);
  }, [orgId, refresh]);

  const allTags = React.useMemo(() => {
    if (projects === null) return [];
    return [...new Set(projects.flatMap((p) => p.tags))].sort();
  }, [projects]);

  const visible = React.useMemo(() => {
    if (projects === null) return [];
    const q = query.trim();
    return projects
      .filter((p) => (q === "" ? true : p.name.includes(q)))
      .filter((p) => (activeTags.length === 0 ? true : activeTags.some((t) => p.tags.includes(t))));
  }, [projects, query, activeTags]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6" data-testid="projects-screen">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-24 font-semibold tracking-tight">项目</h1>
        <p className="text-13 text-muted-foreground">
          一个项目就是一场协作：议程、分组、画布、录音、产出与决策都挂在它下面。
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="projects-refresh"
            onClick={() => refresh(orgId)}
            disabled={listBusy}
          >
            {listBusy ? "加载中…" : "刷新"}
          </Button>
          <div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="视图切换">
            <Button
              size="icon"
              variant={viewMode === "card" ? "primary" : "ghost"}
              aria-pressed={viewMode === "card"}
              data-testid="projects-view-toggle-card"
              onClick={() => setView("card")}
              className="h-7 w-7"
            >
              <LayoutGrid aria-hidden className="h-3.5 w-3.5" />
              <span className="sr-only">卡片视图</span>
            </Button>
            <Button
              size="icon"
              variant={viewMode === "list" ? "primary" : "ghost"}
              aria-pressed={viewMode === "list"}
              data-testid="projects-view-toggle-list"
              onClick={() => setView("list")}
              className="h-7 w-7"
            >
              <ListIcon aria-hidden className="h-3.5 w-3.5" />
              <span className="sr-only">列表视图</span>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目"
              aria-label="搜索项目"
              data-testid="projects-search"
              className="h-8 w-44 pl-7"
            />
          </div>
          <Button asChild variant="primary" size="sm" data-testid="projects-new">
            <Link href="/project/new">
              <Plus aria-hidden className="h-3.5 w-3.5" />
              新建项目
            </Link>
          </Button>
        </div>
      </div>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="projects-tag-filters">
          <TagIcon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={activeTags.includes(tag)}
              data-testid={`projects-tag-filter-${tag}`}
              onClick={() => toggleTag(tag)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-11 transition-colors duration-200",
                activeTags.includes(tag)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {tag}
            </button>
          ))}
          {activeTags.length > 0 ? (
            <Button size="sm" variant="ghost" data-testid="projects-tag-filters-clear" onClick={() => setActiveTags([])}>
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}

      {listError !== null ? (
        <p data-testid="projects-list-error" className="text-12 text-destructive">
          {listError}
        </p>
      ) : null}

      {projects === null ? (
        <div
          data-testid="projects-list-empty-state"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          {listBusy ? "加载中…" : "当前组织还没有项目。"}
        </div>
      ) : visible.length === 0 ? (
        <div
          data-testid="projects-list-empty"
          className="rounded-lg border border-dashed border-border py-6 text-center text-12 text-muted-foreground"
        >
          空列表
        </div>
      ) : viewMode === "card" ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="projects-list">
          {visible.map((p) => (
            <ProjectRealCard key={p.id} project={p} orgId={orgId} layout="card" onChanged={() => void refresh(orgId)} />
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="projects-list">
          {visible.map((p) => (
            <ProjectRealCard key={p.id} project={p} orgId={orgId} layout="list" onChanged={() => void refresh(orgId)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 真实项目卡——只画契约有出处的字段（id/name/kind/status/readOnlyReason/tags）。
 * 没有「准备度」「环节进度」这些原型字段，因为契约根本不提供它们。
 *
 * F164：⋯ 菜单接真 archive/unarchive（编辑/看大屏/复制邀请后端未实现，禁用 + 如实说明）。
 * F185：加标签编辑（增/删，整体替换语义）；`layout` 控制卡片/列表两种密度，
 * 同一份逻辑与 testid，不另外维护第二份组件。
 * F09：⋯ 菜单改走 `components/ui/menu.tsx`（Radix DropdownMenu 别名）——此前是手写
 * `open` state（且此前**没有**外点关闭/Esc 关闭，Radix 原生补上了这个此前缺失的行为）。
 * 归档二次确认子态（`confirming`）用 `onSelect` preventDefault 承接，不让 Radix
 * 「选中即自动关闭」抢走本组件自己的 confirming/busy/error 状态机（F01 当初把这个
 * 文件判定为高风险暂缓，F09 验证过 Radix 受控 `open` + preventDefault 能干净承接）。
 */
function ProjectRealCard({
  project, orgId, layout, onChanged,
}: { project: ProjectListItem; orgId: string; layout: "card" | "list"; onChanged: () => void }) {
  const enterHref = `/projects/${project.id}?org=${encodeURIComponent(orgId)}`;
  const archived = project.status === "archived";

  const [open, setOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = () => { setOpen(false); setConfirming(false); };

  const submit = async () => {
    if (busy) return;               // 提交进行中不发第二个请求
    setBusy(true);
    setError(null);
    try {
      if (archived) await unarchiveProject(project.id);
      else await archiveProject(project.id);
      close();
      onChanged();                  // 刷新列表：readOnlyReason/status 由后端说了算
    } catch (e) {
      setError(describeArchiveError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <Card data-testid={`projects-card-${project.id}`} className="transition-all duration-200 hover:shadow-md">
        <CardContent className={cn("flex flex-col gap-3 p-4", layout === "list" && "sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="truncate text-14 font-semibold tracking-tight" data-testid={`projects-card-${project.id}-name`}>
                  {project.name}
                </h3>
                <p className="text-11 text-muted-foreground">{PROJECT_KIND_LABEL[project.kind]}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge tone={project.status === "active" ? "primary" : "outline"} data-testid={`projects-card-${project.id}-status`}>
                  {PROJECT_STATUS_LABEL[project.status]}
                </Badge>
                {project.readOnlyReason !== null ? (
                  <Badge tone="outline" data-testid={`projects-card-${project.id}-readonly`}>
                    只读 · {project.readOnlyReason === "archived" ? "已归档" : "组织已停用"}
                  </Badge>
                ) : null}

                <Menu
                  open={open}
                  onOpenChange={(next) => {
                    setOpen(next);
                    setConfirming(false);
                    setError(null);
                  }}
                >
                  <MenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="更多操作"
                      data-testid={`projects-card-${project.id}-more`}
                    >
                      <MoreHorizontal aria-hidden className="h-4 w-4" />
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end" sideOffset={4} data-testid={`projects-more-menu-${project.id}`} className="w-64">
                    {confirming ? (
                      <div className="flex flex-col gap-2 p-2" data-testid={`projects-archive-confirm-${project.id}`}>
                        <p className="text-12 font-medium">
                          {archived ? "确认恢复这个项目？" : "确认归档这个项目？"}
                        </p>
                        <div className="rounded-md border border-warning/30 bg-warning/5 p-2">
                          {archived ? (
                            <p className="text-11 text-muted-foreground">恢复后项目重新可写，内容与引用关系不变。</p>
                          ) : (
                            <>
                              <p className="text-11 font-medium text-warning-foreground">归档会影响：</p>
                              {/* 这几条都来自 F124（已 passing）真实验证过的归档语义，不是文案想象 */}
                              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-11 text-muted-foreground">
                                <li>项目转为只读：写入被拒绝，读仍然可用</li>
                                <li>不删除任何内容，误归档可一键恢复</li>
                                <li>已定版的快照仍可被下游引用</li>
                                <li>默认不再被上下文召回，需要时可显式请求</li>
                              </ul>
                            </>
                          )}
                        </div>
                        {error !== null ? (
                          <p className="text-11 text-destructive" data-testid={`projects-archive-error-${project.id}`}>
                            {error}
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`projects-archive-cancel-${project.id}`}
                            onClick={close}
                            disabled={busy}
                          >
                            取消
                          </Button>
                          <Button
                            variant={archived ? "primary" : "destructive"}
                            size="sm"
                            data-testid={`projects-archive-submit-${project.id}`}
                            onClick={() => void submit()}
                            disabled={busy}
                          >
                            {busy ? "提交中…" : archived ? "确认恢复" : "确认归档"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <MenuItemUnavailable testid={`projects-more-${project.id}-edit`}>编辑项目</MenuItemUnavailable>
                        <MenuItemUnavailable testid={`projects-more-${project.id}-bigscreen`}>看现场大屏</MenuItemUnavailable>
                        <MenuItemUnavailable testid={`projects-more-${project.id}-copy-invite`}>复制邀请链接</MenuItemUnavailable>
                        <p
                          className="px-2 py-1 text-9 text-muted-foreground"
                          data-testid={`projects-more-${project.id}-unavailable-note`}
                        >
                          上面三项后端尚未实现，暂不可用。
                        </p>
                        <MenuSeparator />
                        {/* onSelect preventDefault：点「归档/恢复」要切到本组件的 confirming
                            子态，不能让 Radix「选中即关闭」抢先把菜单关掉。 */}
                        <MenuItem
                          data-testid={`projects-more-${project.id}-archive`}
                          onSelect={(event) => { event.preventDefault(); setConfirming(true); setError(null); }}
                          className={cn(archived ? "text-card-foreground" : "text-destructive data-[highlighted]:text-destructive")}
                        >
                          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                          {archived ? "恢复项目" : "归档项目"}
                        </MenuItem>
                        <p className="px-2 py-1 text-9 text-muted-foreground">
                          不提供「删除项目」（Q-9）：归档 = 退役且可只读回看，不销毁内容。
                        </p>
                      </>
                    )}
                  </MenuContent>
                </Menu>
              </div>
            </div>

            <TagsEditor project={project} onChanged={onChanged} />
          </div>

          <div className={cn(layout === "list" && "shrink-0")}>
            <Button asChild variant="primary" size="sm">
              <a href={enterHref} data-testid={`projects-card-${project.id}-enter`}>进入项目</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * F185（2026-08-16 delta）——标签的增/删。整体替换语义：每次操作都把当前完整标签集合
 * 发给 `updateProjectTags`，不是本地乐观拼接后假装成功——提交中禁用输入，失败就地显示，
 * 成功后靠 `onChanged`（父级 `refresh`）刷新，不在本地直接改 `project.tags`。
 */
function TagsEditor({ project, onChanged }: { project: ProjectListItem; onChanged: () => void }) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submitTags = async (nextTags: readonly string[]) => {
    setBusy(true);
    setError(null);
    try {
      await updateProjectTags(project.id, nextTags);
      setAdding(false);
      setDraft("");
      onChanged();
    } catch (e) {
      setError(describeTagsError(e));
    } finally {
      setBusy(false);
    }
  };

  const removeTag = (tag: string) => void submitTags(project.tags.filter((t) => t !== tag));

  const addTag = () => {
    const t = draft.trim();
    if (t === "" || project.tags.includes(t) || project.tags.length >= PROJECT_TAGS_MAX) return;
    void submitTags([...project.tags, t]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid={`projects-card-${project.id}-tags`}>
      {project.tags.map((tag) => (
        <span
          key={tag}
          data-testid={`projects-card-${project.id}-tag-${tag}`}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-10 text-muted-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`移除标签 ${tag}`}
            data-testid={`projects-card-${project.id}-tag-${tag}-remove`}
            onClick={() => void removeTag(tag)}
            disabled={busy}
            className="rounded-full transition-colors duration-200 hover:bg-border"
          >
            <X aria-hidden className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addTag(); }
              if (e.key === "Escape") { setAdding(false); setDraft(""); }
            }}
            placeholder="新标签"
            aria-label="新标签"
            data-testid={`projects-card-${project.id}-tag-input`}
            className="h-6 w-24 text-10"
            disabled={busy}
          />
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-10" onClick={addTag} disabled={busy || draft.trim() === ""} data-testid={`projects-card-${project.id}-tag-confirm`}>
            确定
          </Button>
        </span>
      ) : project.tags.length < PROJECT_TAGS_MAX ? (
        <button
          type="button"
          data-testid={`projects-card-${project.id}-tag-add`}
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-10 text-muted-foreground transition-colors duration-200 hover:bg-muted"
        >
          <Plus aria-hidden className="h-2.5 w-2.5" />
          标签
        </button>
      ) : null}

      {error !== null ? (
        <span className="text-10 text-destructive" data-testid={`projects-card-${project.id}-tags-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** 后端未实现的菜单项：禁用 + 如实说明，不做成点了弹「演示」的假按钮。 */
function MenuItemUnavailable({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <MenuItem disabled data-testid={testid} className="text-muted-foreground opacity-60">
      {children}
    </MenuItem>
  );
}

/**
 * 归档/解归档的失败文案。
 *
 * ⚠ U-2⑵「有进行中环节时拒绝归档」后端**已拦截但没有错误码**，抛的是裸 400
 *   （`KNOWN_CONTRACT_GAPS.P7`，见 issue #999）。此时 `reasonCode` 为空，
 *   我们**只说「操作失败」，绝不替它编一个原因**——编一个未证实的原因比不说更糟
 *   （coord-main 2026-08-12 裁决 (a)）。补码后这里才能显示具体原因。
 */
function describeArchiveError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `操作失败（HTTP ${e.status}）`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}

function describeTagsError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `操作失败（HTTP ${e.status}）`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
