"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { findProject, getProjectOverview, type ProjectListItem, type ProjectOverview } from "@/lib/live-projects";
import { isAidtProject } from "@/features/aidt/lib/project-aidt";
import { ProjectCollaboratorsPanel } from "@/components/project/project-collaborators-panel";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
export function AidtProjectWorkspace({ projectId }: { projectId: string }) {
  const search = useSearchParams();
  const session = useOptionalSession()?.session;
  const orgId = session?.currentOrgId;
  const bearer = session?.sessionToken;
  const userId = session?.userId;
  const hasIdentity = Boolean(orgId && userId && bearer);
  const key = JSON.stringify([orgId, userId, bearer, projectId]);
  const [load, setLoad] = React.useState<{ key: string; project: ProjectListItem | null; overview: ProjectOverview | null; error: "denied" | "failed" | null } | null>(null);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (!hasIdentity || !orgId) return;
    let active = true;
    setLoad(null);
    // Overview is the existing membership guard; a list entry alone never grants access.
    void Promise.all([findProject(orgId, projectId), getProjectOverview(projectId)]).then(([project, overview]) => {
      if (active) setLoad({ key, project, overview, error: null });
    }).catch((e: unknown) => {
      if (active) setLoad({ key, project: null, overview: null, error: e instanceof ApiError && e.status === 403 ? "denied" : "failed" });
    });
    return () => { active = false; };
  }, [orgId, hasIdentity, projectId, key, revision]);
  const current = load?.key === key ? load : null;
  const step = search.get("step");
  return <div className="flex h-full min-h-0 flex-col" data-testid="aidt-project-workspace">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border p-4"><Link href="/aidt" className="text-12 text-muted-foreground transition-colors hover:text-primary">← 小组空间</Link>{current?.error === null && <span className="text-14 font-medium">{current.overview?.name}</span>}</div>
    {!hasIdentity ? <p role="status" className="p-4">请先登录并选择组织。</p> : !current ? <p role="status" data-testid="aidt-project-loading" className="p-4">正在读取项目…</p> : current.error === "denied" ? <p role="alert" data-testid="aidt-access-denied" className="p-4">你没有该项目的访问权限，请联系项目负责人邀请你加入。</p> : current.error === "failed" ? <div role="alert" className="p-4" data-testid="aidt-project-error"><p>项目读取失败。</p><Button variant="outline" onClick={() => setRevision((n) => n + 1)}>重试</Button></div> : !isAidtProject(current.project) ? <p role="alert" data-testid="aidt-profile-required" className="p-4">这不是 AIDT 学习空间。请从 AIDT 入口选择你的小组。</p> : <><details className="shrink-0 border-b border-border px-4 py-2" data-testid="aidt-group-members"><summary className="cursor-pointer text-12">本组成员与可见范围</summary><p className="my-2 text-12 text-muted-foreground">本空间对应一个小组。共享对话供本空间成员协作；老师也需要原有访问权限。个人对话与个人录音不会因关联项目就自动向组员开放。</p><ProjectCollaboratorsPanel key={key} projectId={projectId} readOnly={current.overview?.status !== "active" || current.project?.readOnlyReason !== null} /></details><ProjectAidt projectId={projectId} sub={step ? `aidt-${step}` : "aidt"} canWrite={current.overview?.status === "active" && current.project?.readOnlyReason === null} /></>}
  </div>;
}
