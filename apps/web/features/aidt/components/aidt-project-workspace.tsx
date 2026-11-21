"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { findProject, getProjectOverview, type ProjectListItem, type ProjectOverview } from "@/lib/live-projects";
import { aidtStep, isAidtProject } from "@/features/aidt/lib/project-aidt";
import { AidtEntityHistory } from "./aidt-entity-history";
import { AidtEntityId } from "@repo/contracts/aidt-stages";
import { AidtProjectSettings } from "./aidt-project-settings";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { readAidtProjectMembership } from "@/features/aidt/lib/aidt-project-membership";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
export function AidtProjectWorkspace({ projectId }: { projectId: string }) {
  const search = useSearchParams();
  const session = useOptionalSession()?.session;
  const orgId = session?.currentOrgId;
  const bearer = session?.sessionToken;
  const userId = session?.userId;
  const enabled = isAidtModuleEnabled();
  const hasIdentity = Boolean(orgId && userId && bearer);
  const key = JSON.stringify([orgId, userId, bearer, projectId]);
  const [load, setLoad] = React.useState<{ key: string; project: ProjectListItem | null; overview: ProjectOverview | null; error: "denied" | "failed" | null } | null>(null);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (!enabled || !hasIdentity || !orgId || !userId || !bearer) return;
    let active = true;
    const cancellation = new AbortController();
    setLoad(null);
    // Overview is the existing membership guard; a list entry alone never grants access.
    void Promise.all([findProject(orgId, projectId), getProjectOverview(projectId)]).then(async ([project, overview]) => {
      if (!active) return;
      if ((project && project.id !== projectId) || overview.projectId !== projectId) throw new Error("AIDT_PROJECT_SCOPE_MISMATCH");
      // Overview permits some organization management observers. The real group roster
      // must also include this actor before any teaching content is mounted.
      if (isAidtProject(project)) {
        const role = await readAidtProjectMembership(projectId, userId, bearer, cancellation.signal).catch(() => { throw new Error("AIDT_MEMBERSHIP_LOOKUP_FAILED"); });
        if (!active) return;
        if (!role) { setLoad({ key, project: null, overview: null, error: "denied" }); return; }
      }
      if (active) setLoad({ key, project, overview, error: null });
    }).catch((e: unknown) => {
      if (active) setLoad({ key, project: null, overview: null, error: e instanceof ApiError && e.status === 403 ? "denied" : "failed" });
    });
    return () => { active = false; cancellation.abort(); };
  }, [enabled, orgId, userId, bearer, hasIdentity, projectId, key, revision]);
  const current = load?.key === key ? load : null;
  const step = search.get("step");
  const rawEntityId = search.get("entity");
  const entity = AidtEntityId.safeParse(rawEntityId);
  if (rawEntityId !== null && (!entity.success || !step || !/^[1-6]$/.test(step))) {
    return <p role="alert">产物链接无效。</p>;
  }
  if (!enabled) return <section role="status" data-testid="aidt-workspace-disabled">教学模块尚未启用。</section>;
  const revisionParam = search.get("entityRevision");
  if (revisionParam !== null && current?.error === null && isAidtProject(current.project) && bearer) {
    const selectedStep = aidtStep(step ? `aidt-${step}` : null);
    const revision = /^\d{1,10}$/.test(revisionParam) ? Number(revisionParam) : 0;
    if (!entity.success || !selectedStep || revision < 1 || revision > 2147483647) return <p role="alert">产物版本链接无效。</p>;
    return <AidtEntityHistory key={JSON.stringify([key, selectedStep.id, entity.data, revision])}
      projectId={projectId} step={selectedStep} entityId={entity.data} revision={revision} token={bearer} timestamp={search.get("timestamp")} />;
  }
  return <div className="flex h-full min-h-0 flex-col" data-testid="aidt-project-workspace">
    {!step && <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border/60 px-4 py-3 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/aidt" aria-label="返回小组空间" className="shrink-0 rounded-control p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft aria-hidden className="h-4 w-4" /></Link>
        {current?.error === null && <span className="truncate text-14 font-medium">{current.overview?.name}</span>}
      </div>
      {current?.error === null && isAidtProject(current.project) && <AidtProjectSettings key={key} projectId={projectId} readOnly={current.overview?.status !== "active" || current.project?.readOnlyReason !== null} />}
    </header>}
    {!hasIdentity ? <p role="status" className="p-4">请先登录并选择组织。</p> : !current ? <p role="status" data-testid="aidt-project-loading" className="p-4">正在读取项目…</p> : current.error === "denied" ? <p role="alert" data-testid="aidt-access-denied" className="p-4">你没有该项目的访问权限，请联系项目负责人邀请你加入。</p> : current.error === "failed" ? <div role="alert" className="p-4" data-testid="aidt-project-error"><p>项目读取失败。</p><Button variant="outline" onClick={() => setRevision((n) => n + 1)}>重试</Button></div> : !isAidtProject(current.project) ? <p role="alert" data-testid="aidt-profile-required" className="p-4">这不是 AIDT 学习空间。请从 AIDT 入口选择你的小组。</p> : <><ProjectAidt key={entity.success ? `${step}:${entity.data}` : "stage"} activeEntityId={entity.success ? entity.data : undefined} projectId={projectId} projectName={current.overview?.name} sub={step ? `aidt-${step}` : "aidt"} canWrite={current.overview?.status === "active" && current.project?.readOnlyReason === null} /></>}
  </div>;
}
