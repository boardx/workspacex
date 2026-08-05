"use client";
import * as React from "react";
import Link from "next/link";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/components/session/session-provider";
import {
  PROJECT_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  listProjects,
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
              />
              <ProjectSection
                title="我管着它"
                testId="projects-managed-list"
                items={filterByQuery(segments.managed)}
                orgId={orgId}
              />
            </div>
          )}
        </>
    </div>
  );
}

function ProjectSection({
  title, testId, items, orgId,
}: { title: string; testId: string; items: ProjectListItem[]; orgId: string }) {
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
            <ProjectRealCard key={p.id} project={p} orgId={orgId} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 真实项目卡——只画契约有出处的五个字段。没有「准备度」「环节进度」这些原型字段，
 * 因为契约 `ProjectListItem` 根本不提供它们（宁可少画，不编一个看起来算过的数）。
 */
function ProjectRealCard({ project, orgId }: { project: ProjectListItem; orgId: string }) {
  const enterHref = `/projects/${project.id}?org=${encodeURIComponent(orgId)}`;
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

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
