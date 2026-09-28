export type ProjectResearchSub = "survey" | "itv" | "research" | "transcript";

export function projectResearchHref(projectId: string, sub: ProjectResearchSub): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=research&sub=${sub}`;
}

/** 把 `?projectId=` 续到 Studio 内部的链接上，让往返链在页面跳转后不断。 */
export function withProjectId(href: string, projectId: string | null | undefined): string {
  if (!projectId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}`;
}
