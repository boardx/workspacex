"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOptionalSession } from "@/components/session/session-provider";
import { listProjects, type ProjectListItem } from "@/lib/live-projects";
import { isAidtProject, aidtHref } from "@/features/aidt/lib/project-aidt";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { readAidtProjectMembership } from "@/features/aidt/lib/aidt-project-membership";
import { AidtCreateProjectForm } from "@/features/aidt/components/aidt-create-project-form";
export function AidtHome() {
  const context = useOptionalSession();
  const orgId = context?.session?.currentOrgId;
  const bearer = context?.session?.sessionToken;
  const userId = context?.session?.userId;
  const enabled = isAidtModuleEnabled();
  const hasIdentity = Boolean(orgId && userId && bearer);
  const key = JSON.stringify([orgId, userId, bearer]);
  const [load, setLoad] = React.useState<{ key: string; projects: ProjectListItem[] | null; error: boolean } | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [creationScope, setCreationScope] = React.useState<string | null>(null);
  React.useEffect(() => { setCreationScope(null); }, [key]);
  React.useEffect(() => {
    if (!enabled || !hasIdentity || !orgId || !userId || !bearer) return;
    let active = true;
    const cancellation = new AbortController();
    setLoad(null);
    void listProjects(orgId).then(async (projects) => {
      const candidates = projects.filter(isAidtProject), memberProjects: ProjectListItem[] = [];
      // Load only for this actor/retry, in bounded batches. A failed roster is not an empty group list.
      for (let offset = 0; offset < candidates.length; offset += 4) {
        if (!active || cancellation.signal.aborted) return;
        const batch = candidates.slice(offset, offset + 4);
        const membership = await Promise.all(batch.map((item) => readAidtProjectMembership(item.id, userId, bearer, cancellation.signal)));
        for (const [index, role] of membership.entries()) if (role) memberProjects.push(batch[index]!);
      }
      if (active) setLoad({ key, projects: memberProjects, error: false });
    })
      .catch(() => { if (active) setLoad({ key, projects: null, error: true }); });
    return () => { active = false; cancellation.abort(); };
  }, [enabled, orgId, userId, bearer, hasIdentity, key, revision]);
  const current = load?.key === key ? load : null;
  // Saving the profile uses the existing project lifecycle/tagging permission.
  const canCreate = hasIdentity && (context?.identity?.orgRole === "lead" || context?.identity?.orgRole === "admin");
  if (!enabled) return <section role="status" data-testid="aidt-home-disabled">教学模块尚未启用。</section>;
  return <section className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6" data-testid="aidt-home">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-12 font-medium text-muted-foreground">AIDT · 设计思维</p><h1 className="mt-2 text-30 font-semibold">找到你的小组，继续研究</h1><p className="text-13 text-muted-foreground">每个小组一个学习空间，共同完成六步探索。学生先思考，AI 协助，小组做决定。</p></div>{canCreate && <Button onClick={() => setCreationScope(key)} data-testid="aidt-new">新建小组空间</Button>}</header>
    {!hasIdentity ? <p role="status">请先登录并选择组织。</p> : !current ? <p role="status" data-testid="aidt-home-loading">正在加载 AIDT 项目…</p> : current.error ? <div role="alert" data-testid="aidt-home-error"><p>项目加载失败，不能确定当前项目列表。</p><Button variant="outline" onClick={() => setRevision((n) => n + 1)}>重试</Button></div> : current.projects?.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-13 text-muted-foreground" data-testid="aidt-home-empty">还没有可进入的小组空间。{canCreate ? "请为每个学习小组分别创建空间，再邀请组员。" : "请老师或空间负责人将你加入相应小组；加入后会出现在这里。"}</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{current.projects?.map((project) => <Link key={project.id} href={aidtHref(project.id)} data-testid={`aidt-project-${project.id}`} className="rounded-xl border border-border bg-card p-5 text-card-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"><h2 className="text-16 font-medium">{project.name}</h2><p className="mt-2 text-12 text-muted-foreground">{project.status === "archived" ? "已归档 · 只读" : "进入本组六步 →"}</p></Link>)}</div>}
    <Dialog open={canCreate && creationScope === key} onOpenChange={(open) => setCreationScope(open ? key : null)}><DialogContent><DialogTitle>新建小组空间</DialogTitle><DialogDescription>一个空间对应一个学习小组。请用“小组名 · 研究挑战”命名；只有原权限名单中的成员可进入，创建后再添加组员。</DialogDescription><AidtCreateProjectForm key={key} cancel={<Button variant="ghost" type="button" onClick={() => setCreationScope(null)}>取消</Button>} /></DialogContent></Dialog>
  </section>;
}
