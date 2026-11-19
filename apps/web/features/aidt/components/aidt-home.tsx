"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOptionalSession } from "@/components/session/session-provider";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { loadAidtCourseGroups, type AidtCourseGroup } from "../lib/aidt-course-context";
import { AidtCourseEntry } from "./aidt-course-entry";
import { AidtCoursesPanel } from "./aidt-courses-panel";
import { AidtCreateProjectForm } from "@/features/aidt/components/aidt-create-project-form";
export function AidtHome() {
  const context = useOptionalSession();
  const orgId = context?.session?.currentOrgId;
  const bearer = context?.session?.sessionToken;
  const userId = context?.session?.userId;
  const enabled = isAidtModuleEnabled();
  const hasIdentity = Boolean(orgId && userId && bearer);
  const orgRole = context?.identity?.orgRole ?? null;
  const identity = JSON.stringify([orgId, userId, bearer, orgRole]);
  const lifecycle = React.useRef({ identity, generation: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, generation: lifecycle.current.generation + 1 };
  const key = JSON.stringify([identity, lifecycle.current.generation]);
  const [load, setLoad] = React.useState<{ key: string; projects: readonly AidtCourseGroup[] | null; error: boolean } | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [creationScope, setCreationScope] = React.useState<string | null>(null);
  React.useEffect(() => { setCreationScope(null); }, [key]);
  React.useEffect(() => {
    if (!enabled || !hasIdentity || !orgId || !userId || !bearer) return;
    let active = true;
    const cancellation = new AbortController();
    setLoad(null);
    void loadAidtCourseGroups({ orgId, userId, sessionToken: bearer, signal: cancellation.signal }).then((projects) => {
      if (active && !cancellation.signal.aborted) setLoad({ key, projects, error: false });
    })
      .catch(() => { if (active) setLoad({ key, projects: null, error: true }); });
    return () => { active = false; cancellation.abort(); };
  }, [enabled, orgId, userId, bearer, hasIdentity, key, revision]);
  const current = load?.key === key ? load : null;
  // Saving the profile uses the existing project lifecycle/tagging permission.
  const canCreate = hasIdentity && (context?.identity?.orgRole === "lead" || context?.identity?.orgRole === "admin");
  if (!enabled) return <section role="status" data-testid="aidt-home-disabled">教学模块尚未启用。</section>;
  return <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12" data-testid="aidt-home">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-12 font-medium text-muted-foreground">AIDT · 设计思维</p><h1 className="mt-2 text-30 font-semibold tracking-tight">我的小组</h1><p className="mt-2 text-14 text-muted-foreground">每个小组一个学习空间，让想法在这里生长。</p></div>{canCreate && <Button variant="primary" size="lg" className="rounded-full px-5" onClick={() => setCreationScope(key)} data-testid="aidt-new">新建小组空间</Button>}</header>
    <h2 className="sr-only">全部已加入的小组</h2>
    {!hasIdentity ? <p role="status">请先登录并选择组织。</p> : !current ? <p role="status" data-testid="aidt-home-loading">正在加载 AIDT 项目…</p> : current.error ? <div role="alert" data-testid="aidt-home-error"><p>项目加载失败，不能确定当前项目列表。</p><Button variant="outline" onClick={() => setRevision((n) => n + 1)}>重试</Button></div> : current.projects?.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-13 text-muted-foreground" data-testid="aidt-home-empty">还没有可进入的小组空间。{canCreate ? "请为每个学习小组分别创建空间，再添加组员。" : "请老师或空间负责人将你加入相应小组；加入后会出现在这里。"}</p> : <AidtCourseEntry groups={current.projects ?? []} />}
    {hasIdentity && orgId && userId && bearer && <details className="border-t border-border pt-5 text-13" data-testid="aidt-course-disclosure"><summary className="cursor-pointer rounded-md py-2 font-medium text-muted-foreground transition-colors hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">按课程查找{canCreate ? "与管理" : ""}</summary><div className="mt-4"><AidtCoursesPanel key={key} actor={{ orgId, userId, sessionToken: bearer }} canManage={canCreate} permissionKey={orgRole} availableGroups={current?.projects ?? []} /></div></details>}
    <Dialog open={canCreate && creationScope === key} onOpenChange={(open) => setCreationScope(open ? key : null)}><DialogContent className="gap-6 rounded-2xl p-6 sm:p-8"><div className="space-y-2"><DialogTitle className="text-24 tracking-tight">新建小组</DialogTitle><DialogDescription>先给小组起个名字，研究主题稍后一起讨论。</DialogDescription></div><AidtCreateProjectForm key={key} cancel={<Button variant="ghost" type="button" onClick={() => setCreationScope(null)}>取消</Button>} /></DialogContent></Dialog>
  </section>;
}
