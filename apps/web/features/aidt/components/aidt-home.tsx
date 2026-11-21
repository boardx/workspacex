"use client";
import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CircleHelp, FlaskConical, Layers, Lightbulb, Sparkles, Target, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOptionalSession } from "@/components/session/session-provider";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { AIDT_STEPS } from "../lib/project-aidt";
import { loadAidtCourseGroups, type AidtCourseGroup } from "../lib/aidt-course-context";
import { AidtCourseEntry } from "./aidt-course-entry";
import { AidtCoursesPanel } from "./aidt-courses-panel";
import { AidtCreateProjectForm } from "@/features/aidt/components/aidt-create-project-form";
const workshopIcons = [CircleHelp, Users, Target, Lightbulb, Layers, FlaskConical] as const;

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
  return <section className="min-h-0 flex-1 overflow-y-auto" data-testid="aidt-home">
    <header className="border-b border-border-subtle">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-3 sm:gap-5 sm:px-8">
        <Link href="/home" className="inline-flex items-center gap-2 rounded-control text-13 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft aria-hidden className="h-4 w-4" />返回 WorkspaceX
        </Link>
        <span className="border-l border-border-subtle pl-3 text-14 font-semibold sm:pl-5">AIDT</span>
        <Image src="/aidt/design-thinking-school.png" width={760} height={250} alt="中国传媒大学设计思维学院" className="h-auto w-36 sm:w-44" priority />
      </div>
    </header>
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-7 sm:px-8 sm:py-10">
      <div className="grid items-center gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <h1 className="text-30 font-semibold tracking-tight sm:text-40">设计思维工作坊</h1>
          <p className="text-16 text-muted-foreground">从一个问题出发，用访谈、原型和测试证据迭代。</p>
          <p className="inline-flex items-center gap-2 rounded-container bg-ai-tint px-3 py-2 text-13 font-medium text-ai-tint-foreground">
            <Sparkles aria-hidden className="h-4 w-4 shrink-0" />AI 引导师 · 追问、整理证据、检查假设
          </p>
        </div>
        <Image src="/aidt/workshop-materials.png" width={700} height={310} alt="" priority className="h-auto w-full rounded-container" />
      </div>
      <ol aria-label="工作坊活动" className="grid grid-cols-2 gap-3 rounded-container border border-border-subtle px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
        {AIDT_STEPS.map(({ id, title }, index) => {
          const Icon = workshopIcons[index]!;
          return <li key={id} className="flex items-center gap-2 text-13 font-medium">
            <Icon aria-hidden className="h-5 w-5 shrink-0" />{title}
          </li>;
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-24 font-semibold tracking-tight">我的工作坊</h2>
        {canCreate && <Button variant="primary" onClick={() => setCreationScope(key)} data-testid="aidt-new">新建小组空间</Button>}
      </div>
    {!hasIdentity ? <p role="status">请先登录并选择组织。</p> : !current ? <p role="status" data-testid="aidt-home-loading">正在加载 AIDT 项目…</p> : current.error ? <div role="alert" data-testid="aidt-home-error"><p>项目加载失败，不能确定当前项目列表。</p><Button variant="outline" onClick={() => setRevision((n) => n + 1)}>重试</Button></div> : current.projects?.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-13 text-muted-foreground" data-testid="aidt-home-empty">还没有可进入的小组空间。{canCreate ? "请为每个学习小组分别创建空间，再添加组员。" : "请老师或空间负责人将你加入相应小组；加入后会出现在这里。"}</p> : <AidtCourseEntry groups={current.projects ?? []} />}
    {hasIdentity && orgId && userId && bearer && <details className="border-t border-border pt-5 text-13" data-testid="aidt-course-disclosure"><summary className="cursor-pointer rounded-md py-2 font-medium text-muted-foreground transition-colors hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">按课程查找{canCreate ? "与管理" : ""}</summary><div className="mt-4"><AidtCoursesPanel key={key} actor={{ orgId, userId, sessionToken: bearer }} canManage={canCreate} permissionKey={orgRole} availableGroups={current?.projects ?? []} /></div></details>}
    <Dialog open={canCreate && creationScope === key} onOpenChange={(open) => setCreationScope(open ? key : null)}><DialogContent className="gap-6 rounded-2xl p-6 sm:p-8"><div className="space-y-2"><DialogTitle className="text-24 tracking-tight">新建小组</DialogTitle><DialogDescription>先给小组起个名字，研究主题稍后一起讨论。</DialogDescription></div><AidtCreateProjectForm key={key} cancel={<Button variant="ghost" type="button" onClick={() => setCreationScope(null)}>取消</Button>} /></DialogContent></Dialog>
    </div>
  </section>;
}
