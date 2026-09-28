"use client";
import { ROLE_CAN_WRITE, type ProjectRole } from "@/lib/project-workbench";
import { ProjectConversations } from "./project-conversations";
import { ResearchOverview } from "./research-overview";
import { ProjectResourceSection } from "./project-resource-section";
import { ProjectEvidenceSection } from "./project-evidence-section";
import type { ProjectResearchSub } from "./project-breadcrumb";

const RESOURCE_SUBS: readonly ProjectResearchSub[] = ["survey", "itv", "research", "transcript"];

/**
 * 研究洞察 —— 左侧子导航的分发壳：`sub === "conv"` 渲染本项目的真实对话列表（项目中枢 R4）；
 * `sub ∈ {survey, itv, research, transcript}` 渲染本项目挂着的该类资源真实列表（项目中枢 B2-S2，
 * `ProjectResourceSection`：新建 / 关联已有 / 移出，与各 Studio 经 `?projectId=` 往返）；
 * `sub === "sources"` 渲染本项目证据库的真实列表（项目中枢 B3-T1，`ProjectEvidenceSection`）；
 * 其余落到研究总览（`ResearchOverview`，含「项目大脑」面板，R8/R9）。
 */
export function TabResearch({ view, readOnly = false, sub = null, projectId }: {
  view: ProjectRole; readOnly?: boolean; sub?: string | null; projectId?: string;
}) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  if (sub === "conv" && projectId) {
    return <ProjectConversations projectId={projectId} canWrite={canWrite} />;
  }
  if (sub === "sources" && projectId) {
    return <ProjectEvidenceSection projectId={projectId} />;
  }
  if (projectId && RESOURCE_SUBS.includes(sub as ProjectResearchSub)) {
    return <ProjectResourceSection projectId={projectId} kind={sub as ProjectResearchSub} canWrite={canWrite} />;
  }
  return <ResearchOverview view={view} readOnly={readOnly} projectId={projectId} />;
}
