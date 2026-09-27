"use client";
import { ROLE_CAN_WRITE, type ProjectRole } from "@/lib/project-workbench";
import { ProjectConversations } from "./project-conversations";
import { ResearchOverview } from "./research-overview";

/**
 * 研究洞察 —— 左侧子导航的分发壳：`sub === "conv"` 渲染本项目的真实对话列表（项目中枢 R4）；
 * 其余子项目前落到研究总览（`ResearchOverview`，含「项目大脑」面板，R8/R9）。
 * 各子项（问卷 / 用户洞察 / 深度研究 / 录音转写）的真实列表在项目中枢 B2 接入。
 */
export function TabResearch({ view, readOnly = false, sub = null, projectId }: {
  view: ProjectRole; readOnly?: boolean; sub?: string | null; projectId?: string;
}) {
  if (sub === "conv" && projectId) {
    return <ProjectConversations projectId={projectId} canWrite={ROLE_CAN_WRITE[view] && !readOnly} />;
  }
  return <ResearchOverview view={view} readOnly={readOnly} projectId={projectId} />;
}
