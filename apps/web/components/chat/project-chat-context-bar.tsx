"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getProjectOverview } from "@/lib/live-projects";

/**
 * 项目对话的上下文条（issue #4744 ④）——`/chat/<threadId>?projectId=<id>` 与个人对话复用
 * 同一个壳，唯一的区别就是顶部多这一条：「← 返回项目」+ 项目名徽标。
 *
 * 项目名走 `getProjectOverview`（不依赖 `?org=`，服务端按 principal 取组织）。读不到
 * （无权限 / 网络 / 未登录）时只显示「项目对话」，不崩、不阻塞返回链接。
 * 返回链接：通用项目 → 「内容」tab；工作坊 → 项目默认页。组织用 session 的 `orgId` 补 `?org=`。
 */
export function projectBackHref(projectId: string, kind: string | null, orgId: string | null): string {
  const params: string[] = [];
  if (orgId) params.push(`org=${encodeURIComponent(orgId)}`);
  if (kind !== "workshop") params.push("tab=content");
  const qs = params.length > 0 ? `?${params.join("&")}` : "";
  return `/projects/${encodeURIComponent(projectId)}${qs}`;
}

export function ProjectChatContextBar({ projectId, orgId, bearer }: {
  projectId: string; orgId: string | null; bearer: string | null;
}): JSX.Element {
  const [info, setInfo] = React.useState<{ id: string; name: string; kind: string } | null>(null);
  React.useEffect(() => {
    if (!bearer) return;
    let cancelled = false;
    void getProjectOverview(projectId).then(
      (overview) => { if (!cancelled) setInfo({ id: projectId, name: overview.name, kind: overview.kind }); },
      () => { if (!cancelled) setInfo(null); },
    );
    return () => { cancelled = true; };
  }, [projectId, bearer]);
  const known = info !== null && info.id === projectId ? info : null;
  return (
    <nav
      aria-label="项目上下文"
      className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-muted/40 px-6 py-1.5"
      data-testid="project-chat-context-bar"
    >
      <Link
        href={projectBackHref(projectId, known?.kind ?? null, orgId)}
        data-testid="project-chat-back"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />返回项目
      </Link>
      <Badge tone="neutral" className="min-w-0 max-w-[60%] truncate" data-testid="project-chat-name">
        {known ? known.name : "项目对话"}
      </Badge>
    </nav>
  );
}
