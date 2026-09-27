"use client";
import { ArrowLeft } from "lucide-react";

/**
 * 项目 ⇄ Studio 往返的面包屑（项目中枢 B2-S2）。
 *
 * 各 Studio（问卷 / 深度研究 / 录音转写 / 用户访谈）从项目子导航带着 `?projectId=` 进来时，
 * 顶部挂这一条「← 返回项目」，链回 `/projects/<id>?tab=research&sub=<kind>`——
 * 没有 `projectId` 的独立 Studio 访问不渲染任何东西（调用方直接传 `null` 即可）。
 */
export type ProjectResearchSub = "survey" | "itv" | "research" | "transcript";

export function projectResearchHref(projectId: string, sub: ProjectResearchSub): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=research&sub=${sub}`;
}

/** 把 `?projectId=` 续到 Studio 内部的链接上，让往返链在页面跳转后不断。 */
export function withProjectId(href: string, projectId: string | null | undefined): string {
  if (!projectId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}`;
}

export function ProjectBreadcrumb({ projectId, sub, className }: {
  projectId: string | null | undefined; sub: ProjectResearchSub; className?: string;
}) {
  if (!projectId) return null;
  return (
    <nav aria-label="返回项目" className={className ?? "px-5 pt-4 md:px-8 lg:px-10"} data-testid="project-breadcrumb">
      <a
        href={projectResearchHref(projectId, sub)}
        data-testid="project-breadcrumb-back"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />返回项目
      </a>
    </nav>
  );
}
