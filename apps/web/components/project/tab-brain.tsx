"use client";
import { ProjectBrainPanel } from "./project-brain-panel";
import { ProjectEvidenceSection } from "./project-evidence-section";

/**
 * 通用项目 ·「大脑」tab（#4615，PROP-PROJECT-WORKSPACE-001 §3.4）：推演（结论 / 冲突 / 缺口 / 推理链 /
 * 采纳为决策，`ProjectBrainPanel`）在上，来源（证据库，`ProjectEvidenceSection`）在下。
 * 两块原样搬自工作坊的「研究洞察 › 研究总览 / 来源」，testid 不变。
 */
export function TabBrain({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-col" data-testid="project-brain-tab">
      <div className="mx-auto w-full max-w-4xl px-6 pt-6">
        <ProjectBrainPanel projectId={projectId} />
      </div>
      <ProjectEvidenceSection projectId={projectId} />
    </div>
  );
}
