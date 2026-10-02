"use client";
import * as React from "react";
import Link from "next/link";
import { Search, Plus, MoreHorizontal, AlertTriangle, Check, Link2, LayoutGrid, List as ListIcon, X, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ResourceCard } from "@/components/ui/resource-card";
import { TagFilterBar } from "@/components/ui/tag-filter-bar";
import { InlineTagEditor } from "@/components/ui/inline-tag-editor";
import { aggregateTags, matchesQuery, matchesTags, searchPlaceholder } from "@/lib/tag-utils";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { StateShell } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/session/session-provider";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import {
  PROJECT_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_TAGS_MAX,
  PROJECT_TAG_MAX_LENGTH,
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
  const [listError, setListError] = React.useState<boolean>(false);
  const [listBusy, setListBusy] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  // 受控弹窗没有 DialogTrigger：自己记住是谁打开的，关闭后把键盘焦点还给它（否则焦点落回 <body>，键盘用户要重新从头 Tab）。
  const createTriggerRef = React.useRef<HTMLElement | null>(null);
  const openCreate = () => {
    createTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCreateOpen(true);
  };
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
    setListError(false);
    try {
      const out = await listProjects(org);
      setProjects([...out]);
    } catch {
      setListError(true);
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

  const tagOptions = React.useMemo(
    () => (projects === null ? [] : [...aggregateTags(projects).entries()].map(([tag, count]) => ({ tag, count }))),
    [projects],
  );
  const allTags = tagOptions;

  /** 当前是不是处在「被筛选」的状态——决定空列表该说哪句话。 */
  const filtering = query.trim() !== "" || activeTags.length > 0;

  const visible = React.useMemo(() => {
    if (projects === null) return [];
    const q = query.trim();
    return projects
      .filter((p) => matchesQuery(q, [p.name], p.tags))
      .filter((p) => matchesTags(p.tags, activeTags));
  }, [projects, query, activeTags]);


  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6" data-testid="projects-screen">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-24 font-semibold tracking-tight">项目</h1>
        <p className="text-13 text-muted-foreground">
          将对话、白板、研究与产出收在同一处团队工作空间。
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
              placeholder={searchPlaceholder("项目")}
              aria-label="搜索项目"
              data-testid="projects-search"
              className="h-8 w-56 pl-7"
            />
          </div>
          <Button variant="primary" size="sm" data-testid="projects-new" onClick={openCreate}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            新建项目
          </Button>
        </div>
      </div>

      {allTags.length > 0 ? (
        <div data-testid="projects-tag-filters">
          <TagFilterBar tags={tagOptions} selected={activeTags} onChange={setActiveTags} prefix="projects" business="项目" />
        </div>
      ) : null}

      {listError ? (
        <div data-testid="projects-list-error">
          <StateShell
            state="dep-failed"
            depFailure={{ what: "项目列表暂时读不出来，请稍后重试。", retry: () => void refresh(orgId) }}
          >{null}</StateShell>
        </div>
      ) : null}

      {projects === null && listError ? null : projects === null ? (
        <div
          data-testid="projects-list-empty-state"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          {listBusy ? "加载中…" : "当前组织还没有项目。"}
        </div>
      ) : visible.length === 0 ? (
        /*
          两种「什么都没有」必须分开说（#3872 R1）。

          改之前这里只有两个字：「空列表」。它同时被用在「你还没有建过项目」和
          「搜索/标签筛掉了全部」两种处境上——而这两种处境下用户该做的事完全相反：
          前者要建一个，后者要把筛选条件去掉。把它们合并成同一句话，等于什么都没说。
          而且「空列表」是开发者的词，不是产品的词；新用户装完应用第一眼看到的就是它。
        */
        <div
          data-testid="projects-list-empty"
          className="rounded-lg border border-dashed border-border px-6 py-10 text-center"
        >
          {filtering ? (
            <>
              <p className="text-13 text-card-foreground">没有符合当前筛选条件的项目。</p>
              <p className="mt-1 text-12 text-muted-foreground">
                你一共有 {projects.length} 个项目，当前条件把它们都筛掉了。
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                data-testid="projects-empty-clear-filters"
                onClick={() => { setQuery(""); setActiveTags([]); }}
              >
                清除筛选条件
              </Button>
            </>
          ) : (
            <>
              <p className="text-13 text-card-foreground">这里还没有项目。</p>
              <p className="mt-1 text-12 leading-relaxed text-muted-foreground">
                一个项目是一处团队工作空间：对话、白板、访谈、问卷、研究、设计都收在一起，AI 在项目大脑里帮你推演结论。
                <br />
                也可以先不建项目，直接去「对话」里交一件事给 AI。
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={openCreate} data-testid="projects-empty-create"><Plus aria-hidden className="size-4" />新建项目</Button>
                <Button variant="outline" asChild><Link href="/chat">先去对话</Link></Button>
              </div>
            </>
          )}
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

      {/* #4743：新建项目走弹窗（同系统其它创建弹窗），不再跳独立页 */}
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCloseAutoFocus={(event) => { event.preventDefault(); createTriggerRef.current?.focus(); }}
      />
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

  const [copied, setCopied] = React.useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/projects/${project.id}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);            // 剪贴板不可用（非安全上下文等）：不假装成功
    }
  };

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
      <ResourceCard
        testId={`projects-card-${project.id}`}
        headingLevel={2}
        layout={layout === "list" ? "list" : "grid"}
        title={project.name}
        titleTestId={`projects-card-${project.id}-name`}
        subtitle={PROJECT_KIND_LABEL[project.kind]}
        badges={
          <>
        <Badge tone={project.status === "active" ? "primary" : "outline"} data-testid={`projects-card-${project.id}-status`}>
          {PROJECT_STATUS_LABEL[project.status]}
        </Badge>
        {project.readOnlyReason !== null ? (
          <Badge tone="outline" data-testid={`projects-card-${project.id}-readonly`}>
            只读 · {project.readOnlyReason === "archived" ? "已归档" : "组织已停用"}
          </Badge>
        ) : null}
          </>
        }
        menu={
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
                <MenuItem
                  data-testid={`projects-more-${project.id}-copy-link`}
                  onSelect={(event) => { event.preventDefault(); void copyLink(); }}
                >
                  {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Link2 aria-hidden className="h-3.5 w-3.5" />}
                  {copied ? "已复制项目链接" : "复制项目链接"}
                </MenuItem>
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
              </>
            )}
          </MenuContent>
        </Menu>
        }
        tags={<TagsEditor project={project} onChanged={onChanged} />}
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href={enterHref} data-testid={`projects-card-${project.id}-enter`}>进入项目</Link>
          </Button>
        }
      />
    </li>
  );
}

/**
 * F185（2026-08-16 delta）——标签的增/删。整体替换语义：每次操作都把当前完整标签集合
 * 发给 `updateProjectTags`，不是本地乐观拼接后假装成功——提交中禁用输入，失败就地显示，
 * 成功后靠 `onChanged`（父级 `refresh`）刷新，不在本地直接改 `project.tags`。
 */
function TagsEditor({ project, onChanged }: { project: ProjectListItem; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 整体替换语义：每次操作都把当前完整标签集合发给 `updateProjectTags`，不是本地乐观拼接后假装成功——
  // 提交中禁用，失败就地显示，成功后靠 `onChanged`（父级 `refresh`）刷新。
  const submitTags = async (nextTags: readonly string[]) => {
    setBusy(true);
    setError(null);
    try {
      await updateProjectTags(project.id, nextTags);
      onChanged();
    } catch (e) {
      setError(describeTagsError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <InlineTagEditor
      tags={project.tags}
      onChange={(next) => void submitTags(next)}
      busy={busy}
      error={error}
      compact
      maxTags={PROJECT_TAGS_MAX}
      maxTagLength={PROJECT_TAG_MAX_LENGTH}
      testidPrefix={`projects-card-${project.id}`}
    />
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
