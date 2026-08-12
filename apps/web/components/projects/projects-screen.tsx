"use client";
import * as React from "react";
import Link from "next/link";
import { Search, Plus, MoreHorizontal, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/session/session-provider";
import {
  PROJECT_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  archiveProject,
  listProjects,
  unarchiveProject,
  type ProjectListItem,
} from "@/lib/live-projects";

/**
 * 项目列表主体（F353 —— 从 `lib/mock/projects.ts` 切到真实 `GET /projects`）。
 *
 * ⚠ 为什么不是「保留原型卡片，只换数据源」：契约 `ProjectListItem` 只有五个字段
 * （id/name/kind/status/readOnlyReason），原型卡片（`ProjectSummary`，见
 * `lib/mock/projects.ts`）画的 `readiness`/`stageProgress`/`schedule`/`owner`/
 * `priority` 全部**没有出处**——F122 当年新开 `/project/live` 而不是直接接 `/projects`
 * 就是为了不编这些字段（该页面文件头注逐字写明）。这次按 issue #353 的裁决把真实
 * 数据接到用户真正会用的 `/projects` 上：字段完整度**如实**收窄到契约有的那五个，
 * 不补一个「看起来算过的数」。原型的筛选（客户/内部/高优先级）同理去掉——
 * 契约里没有 `owner`/`priority` 这两个字段，没法筛。
 *
 * `orgId` 来自根级 SessionProvider 已解析的真实 current-org，不再由用户手填，也不在
 * 项目页内重复维护第二套登录状态。
 */
export function ProjectsScreen() {
  const { session } = useSession();
  if (!session) throw new Error("ProjectsScreen requires an authenticated session");
  const orgId = session.currentOrgId;

  const [segments, setSegments] = React.useState<{ member: ProjectListItem[]; managed: ProjectListItem[] } | null>(
    null,
  );
  const [listError, setListError] = React.useState<string | null>(null);
  const [listBusy, setListBusy] = React.useState(false);

  const [query, setQuery] = React.useState("");

  const refresh = React.useCallback(async (org: string) => {
    if (org === "") return;
    setListBusy(true);
    setListError(null);
    try {
      const out = await listProjects(org);
      setSegments({ member: [...out.member], managed: [...out.managed] });
    } catch (e) {
      setListError(describeError(e));
      setSegments(null);
    } finally {
      setListBusy(false);
    }
  }, []);

  // current-org changes only through the signed switch operation; each change reloads this list.
  React.useEffect(() => {
    setSegments(null);
    void refresh(orgId);
  }, [orgId, refresh]);

  const filterByQuery = (items: ProjectListItem[]) =>
    query.trim() ? items.filter((p) => p.name.includes(query.trim())) : items;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6" data-testid="projects-screen">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-24 font-semibold tracking-tight">项目</h1>
        <p className="text-13 text-muted-foreground">
          一个项目就是一场协作：议程、分组、画布、录音、产出与决策都挂在它下面。
        </p>
      </header>

      <>
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

          {listError !== null ? (
            <p data-testid="projects-list-error" className="text-12 text-destructive">
              {listError}
            </p>
          ) : null}

          {segments === null ? (
            <div
              data-testid="projects-list-empty-state"
              className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
            >
              {listBusy ? "加载中…" : "当前组织还没有项目。"}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <ProjectSection
                title="我在里面"
                testId="projects-member-list"
                items={filterByQuery(segments.member)}
                orgId={orgId}
                onChanged={() => void refresh(orgId)}
              />
              <ProjectSection
                title="我管着它"
                testId="projects-managed-list"
                items={filterByQuery(segments.managed)}
                orgId={orgId}
                onChanged={() => void refresh(orgId)}
              />
            </div>
          )}
        </>
    </div>
  );
}

function ProjectSection({
  title, testId, items, orgId, onChanged,
}: { title: string; testId: string; items: ProjectListItem[]; orgId: string; onChanged: () => void }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-13 font-semibold">{title}</h2>
      {items.length === 0 ? (
        <div
          data-testid={`${testId}-empty`}
          className="rounded-lg border border-dashed border-border py-6 text-center text-12 text-muted-foreground"
        >
          空列表
        </div>
      ) : (
        <ul className="flex flex-col gap-3" data-testid={testId}>
          {items.map((p) => (
            <ProjectRealCard key={p.id} project={p} orgId={orgId} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 真实项目卡——只画契约有出处的五个字段。没有「准备度」「环节进度」这些原型字段，
 * 因为契约 `ProjectListItem` 根本不提供它们（宁可少画，不编一个看起来算过的数）。
 *
 * F164：补上 `⋯` 菜单并接真 archive/unarchive。菜单四项依 `contracts/project/ui.md`
 * （编辑 / 看大屏 / 复制邀请 / 归档，**无删除**——Q-9 裁不提供删除项目，退役由归档承接）。
 * 其中前三项后端未实现，**禁用 + 如实说明**，不做成点了会弹「演示」的假按钮
 * （原型组件 `project-more-menu.tsx` 是那样做的，本真栈卡片不复用它的接线）。
 */
function ProjectRealCard({
  project, orgId, onChanged,
}: { project: ProjectListItem; orgId: string; onChanged: () => void }) {
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
        <CardContent className="flex flex-col gap-3 p-4">
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

              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="更多操作"
                  aria-expanded={open}
                  data-testid={`projects-card-${project.id}-more`}
                  onClick={() => { setOpen((v) => !v); setConfirming(false); setError(null); }}
                >
                  <MoreHorizontal aria-hidden className="h-4 w-4" />
                </Button>

                {open ? (
                  <div
                    role="menu"
                    data-testid={`projects-more-menu-${project.id}`}
                    className="absolute right-0 top-9 z-10 w-64 rounded-lg border border-border bg-popover p-1 shadow-md"
                  >
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
                      <div className="flex flex-col">
                        <MenuItemUnavailable testid={`projects-more-${project.id}-edit`}>编辑项目</MenuItemUnavailable>
                        <MenuItemUnavailable testid={`projects-more-${project.id}-bigscreen`}>看现场大屏</MenuItemUnavailable>
                        <MenuItemUnavailable testid={`projects-more-${project.id}-copy-invite`}>复制邀请链接</MenuItemUnavailable>
                        <p
                          className="px-2 py-1 text-9 text-muted-foreground"
                          data-testid={`projects-more-${project.id}-unavailable-note`}
                        >
                          上面三项后端尚未实现，暂不可用。
                        </p>
                        <div className="my-1 h-px bg-border" aria-hidden />
                        <button
                          type="button"
                          role="menuitem"
                          data-testid={`projects-more-${project.id}-archive`}
                          onClick={() => { setConfirming(true); setError(null); }}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-12",
                            "transition-colors duration-200 hover:bg-muted",
                            archived ? "text-card-foreground" : "text-destructive",
                          )}
                        >
                          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                          {archived ? "恢复项目" : "归档项目"}
                        </button>
                        <p className="px-2 py-1 text-9 text-muted-foreground">
                          不提供「删除项目」（Q-9）：归档 = 退役且可只读回看，不销毁内容。
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div>
            <Button asChild variant="primary" size="sm">
              <a href={enterHref} data-testid={`projects-card-${project.id}-enter`}>进入项目</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

/** 后端未实现的菜单项：禁用 + 如实说明，不做成点了弹「演示」的假按钮。 */
function MenuItemUnavailable({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled
      data-testid={testid}
      className="rounded-md px-2 py-1.5 text-left text-12 text-muted-foreground opacity-60"
    >
      {children}
    </button>
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

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
