"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { isProjectMemberChatEnabled } from "@/lib/project-member-chat-config";
import { isMemberChatComposing } from "@/lib/project-member-chat-input";
import { memberChatProjectFromLocation } from "@/lib/project-member-chat-navigation";

const MemberChat = dynamic(() => import("./project-member-chat").then((module) => module.ProjectMemberChat), {
  ssr: false, loading: () => <p role="status" className="p-4 text-13 text-muted-foreground">正在打开小组讨论…</p>,
});
type ProjectItem = z.infer<typeof project.ProjectListItem>;

/** Mounted once below SessionProvider; module disabled means no UI, requests or child initialization. */
export function ProjectMemberChatLauncher() {
  if (!isProjectMemberChatEnabled()) return null;
  return <AuthenticatedLauncher />;
}
function AuthenticatedLauncher() {
  const context = useOptionalSession();
  if (context?.status !== "authenticated" || !context.session?.currentOrgId || !context.session.userId || !context.session.sessionToken) return null;
  const { currentOrgId, userId, sessionToken } = context.session;
  return <Launcher key={JSON.stringify([currentOrgId, userId])} orgId={currentOrgId} sessionToken={sessionToken} />;
}
function Launcher({ orgId, sessionToken }: { orgId: string; sessionToken: string }) {
  const pathname = usePathname(), search = useSearchParams();
  const routeProject = memberChatProjectFromLocation(pathname, search);
  const [open, setOpen] = React.useState(false);
  const [projectId, chooseProject] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState(0);
  const authKey = JSON.stringify([orgId, sessionToken]);
  const [listing, setListing] = React.useState<{ key: string; items: ProjectItem[]; loading: boolean; error: boolean } | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null), panel = React.useRef<HTMLElement>(null);
  const current = listing?.key === authKey ? listing : null;
  const projects = current?.items ?? [];
  const currentProject = projects.find((item) => item.id === projectId);
  const close = React.useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    setListing((old) => ({ key: authKey, items: old?.key === authKey ? old.items : [], loading: true, error: false }));
    const operation = project.operations.listProjects;
    void apiRequest<unknown>(operation.path, { method: operation.method, query: { orgId }, sessionToken, signal: controller.signal })
      .then((value) => { if (active) setListing({ key: authKey, items: operation.out.parse(value), loading: false, error: false }); })
      .catch(() => { if (active) setListing((old) => ({ key: authKey, items: old?.key === authKey ? old.items : [], loading: false, error: true })); });
    return () => { active = false; controller.abort(); };
  }, [open, orgId, sessionToken, authKey, retry]);
  React.useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLSelectElement>("select")?.focus();
    const escape = (event: KeyboardEvent) => {
      const target = event.target;
      const ownsEvent = target instanceof Node && (panel.current?.contains(target) || trigger.current?.contains(target))
        || target === document && Boolean(panel.current?.contains(document.activeElement));
      if (ownsEvent && event.key === "Escape" && !event.defaultPrevented && !isMemberChatComposing(event)) { event.preventDefault(); close(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, close]);
  return <>
    <Button ref={trigger} type="button" variant="outline" size="sm" className="fixed bottom-20 right-4 z-40 gap-2 rounded-full bg-card shadow-md md:bottom-4" aria-controls="project-member-chat-panel" aria-expanded={open} data-testid="global-member-chat-open" onClick={() => { if (open) close(); else { if (!projectId && routeProject) chooseProject(routeProject); setOpen(true); } }}><MessageCircle aria-hidden className="h-4 w-4" />小组讨论</Button>
    <aside ref={panel} id="project-member-chat-panel" hidden={!open} role="dialog" aria-modal={false} aria-labelledby="project-member-chat-title" data-testid="global-member-chat-panel" className={`${open ? "flex" : "hidden"} fixed bottom-20 right-0 top-4 z-40 w-full max-w-md flex-col overflow-hidden rounded-l-xl border border-border bg-card shadow-xl md:bottom-4 md:right-4 md:top-16 md:rounded-xl`}>
      <header className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between gap-3"><h2 id="project-member-chat-title" className="text-14 font-semibold">成员文字讨论</h2><Button type="button" size="icon" variant="ghost" aria-label="关闭小组讨论" data-testid="global-member-chat-close" onClick={close}><X aria-hidden className="h-4 w-4" /></Button></div>
        <label className="block text-12 text-muted-foreground">沟通对象<select aria-label="选择讨论小组项目" data-testid="global-member-chat-project" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13 text-foreground" value={projectId ?? ""} onChange={(event) => chooseProject(event.currentTarget.value || null)}><option value="" disabled={Boolean(projectId)}>选择所属项目或小组</option>{projectId && !currentProject && <option value={projectId}>当前页面项目 · 待核对访问权限</option>}{projects.map((item) => <option value={item.id} key={item.id}>{item.name}{item.status === "archived" ? " · 已归档" : ""}</option>)}</select></label>
        {routeProject && routeProject !== projectId && <Button type="button" size="xs" variant="ghost" data-testid="global-member-chat-current-project" onClick={() => chooseProject(routeProject)}>使用当前页面的项目</Button>}
        {current?.loading && <p role="status" className="text-11 text-muted-foreground">正在核对可访问的项目…</p>}
        {current?.error && <div role="alert" className="flex items-center justify-between gap-2 text-12"><p>项目列表读取失败，尚未判断是否为空。</p><Button size="xs" variant="outline" data-testid="global-member-chat-project-retry" onClick={() => setRetry((value) => value + 1)}>重试</Button></div>}
        {current && !current.loading && !current.error && !projects.length && <p className="text-12 text-muted-foreground">当前没有可访问的项目，请先创建或加入小组。</p>}
      </header>
      {projectId ? <div className="flex min-h-0 flex-1 flex-col" data-testid="global-member-chat-workspace"><MemberChat projectId={projectId} active={open} compact={false} onClose={close} /></div> : <p className="p-5 text-13 text-muted-foreground">选择小组后，随时在这里讨论分工和下一步。讨论消息不会自动成为阶段成果。</p>}
    </aside>
  </>;
}
