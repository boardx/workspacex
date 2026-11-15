"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { listProjectResources, PROJECT_RESOURCE_KIND_LABEL_ZH, type ProjectResourceItem } from "@/lib/live-project-resources";
import { AIDT_STEPS, aidtHref } from "@/features/aidt/lib/project-aidt";
import { projectResourceHref, describeProjectResourceFailure } from "@/components/project/project-resource-section";

export function AidtMaterials({ projectId, stageNumber, thread, returnRevision }: { projectId: string; stageNumber?: number; thread?: string | null; returnRevision?: string | null }) {
  const stage = AIDT_STEPS.find((item) => item.id === stageNumber)?.id;
  // A thread belongs to its source stage; do not carry it into a guessed stage.
  const sourceThread = stage ? thread : undefined;
  const sourceRound = stage ? returnRevision : undefined;
  const session = useOptionalSession()?.session;
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId]);
  const hasIdentity = Boolean(session?.currentOrgId && session?.userId && session?.sessionToken);
  const [state, setState] = React.useState<{ scope: string; items?: ProjectResourceItem[]; error?: string } | null>(null);
  const [revision, refresh] = React.useState(0);
  React.useEffect(() => {
    if (!hasIdentity) return;
    let active = true;
    setState(null);
    void listProjectResources(projectId).then((out) => { if (active) setState({ scope, items: out.items }); })
      .catch((error: unknown) => { if (active) setState({ scope, error: describeProjectResourceFailure(error) }); });
    return () => { active = false; };
  }, [scope, projectId, revision, hasIdentity]);
  const current = state?.scope === scope ? state : null;
  function href(item: ProjectResourceItem) {
    if (item.kind === "design") return aidtHref(projectId, stage ?? 5, { tool: "design", resource: item.id, thread: sourceThread, returnRevision: sourceRound });
    if (item.kind === "personal_transcription") return aidtHref(projectId, stage ?? 2, { tool: "transcript", resource: item.id, thread: sourceThread, returnRevision: sourceRound });
    const url = new URL(projectResourceHref(item.kind, item.id, projectId), "https://workspace.invalid");
    url.searchParams.set("aidtStep", String(stage ?? 2));
    if (sourceThread) url.searchParams.set("aidtThread", sourceThread);
    if (sourceRound) url.searchParams.set("aidtReturnRevision", sourceRound);
    return `${url.pathname}${url.search}`;
  }
  return <section className="space-y-3" aria-label="小组已关联资料" data-testid="aidt-materials">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-16 font-semibold">小组已关联资料</h3><Button variant="ghost" size="sm" onClick={() => refresh((n) => n + 1)}>刷新资料</Button></div>
    <p className="text-12 text-muted-foreground">来自原生资料服务。关联不代表材料已核实，也不改变原资源访问权限；设计方案与个人笔记不能自动当作真实访谈证据。</p>
    {!hasIdentity ? <p role="status" className="text-13">登录后可读取本组资料。</p> : !current ? <p role="status" className="text-13">正在读取已关联资料…</p> : current.error ? <div role="alert" className="text-13"><p>{current.error}</p><Button variant="outline" size="sm" onClick={() => refresh((n) => n + 1)}>重新读取资料</Button></div> : !current.items?.length ? <p className="rounded-lg border border-dashed border-border p-4 text-13 text-muted-foreground">当前没有已关联资料。可先在共情用户步骤收集或关联获准分享的材料。</p> : <ul className="divide-y divide-border rounded-lg border border-border px-3">{current.items.map((item) => <li key={`${item.kind}:${item.id}`} className="py-3"><Link className="break-words text-13 font-medium text-primary underline" href={href(item)}>{item.title}</Link><p className="mt-1 text-12 text-muted-foreground">{PROJECT_RESOURCE_KIND_LABEL_ZH?.[item.kind] ?? item.kind} · 状态：{item.status ?? "未提供"}</p>{item.kind === "personal_transcription" && <p className="mt-1 text-12 text-muted-foreground" data-testid="aidt-personal-transcript-boundary">个人笔记转录；关联不改变所有者权限，也不能替代项目访谈的参与者同意。</p>}<p className="mt-1 break-words text-11 text-muted-foreground">资料更新时间：{Number.isFinite(Date.parse(item.updatedAt)) ? new Date(item.updatedAt).toLocaleString() : "未提供"}</p></li>)}</ul>}
    <Link href={aidtHref(projectId, stage ?? 2, { tool: "sources", thread: sourceThread, returnRevision: sourceRound })} className="inline-block text-12 text-primary underline">查看原始证据与出处 →</Link>
  </section>;
}
