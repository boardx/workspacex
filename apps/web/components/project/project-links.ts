/**
 * 项目内资源子页键（研究洞察子导航 / 通用项目「内容」的类型筛选共用）。
 * #4615：加白板 / 设计（通用项目才有入口；工作坊的研究洞察子导航不变）。
 */
export type ProjectResearchSub = "survey" | "itv" | "research" | "transcript" | "whiteboard" | "design";

export function projectResearchHref(projectId: string, sub: ProjectResearchSub): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=research&sub=${sub}`;
}

/** 把 `?projectId=` 续到 Studio 内部的链接上，让往返链在页面跳转后不断。 */
export function withProjectId(href: string, projectId: string | null | undefined): string {
  if (!projectId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}`;
}
