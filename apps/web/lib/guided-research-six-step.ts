export const GUIDED_RESEARCH_SIX_STEPS = [
  { id: "list", label: "研究列表" },
  { id: "import", label: "导入需求" },
  { id: "topic", label: "确认研究主题" },
  { id: "plan", label: "研究计划" },
  { id: "research", label: "资料研究" },
  { id: "report", label: "研究报告" },
] as const;

export type GuidedResearchVisualStage = (typeof GUIDED_RESEARCH_SIX_STEPS)[number]["id"];
type RuntimeNode = "brief" | "directions" | "outline" | "research" | "report";

const nodeToStage: Record<RuntimeNode, GuidedResearchVisualStage> = {
  brief: "import",
  directions: "topic",
  outline: "plan",
  research: "research",
  report: "report",
};

export function toGuidedResearchVisualStage(runtime: { currentNode: RuntimeNode; availableNodes: readonly RuntimeNode[] }): {
  current: GuidedResearchVisualStage;
  available: GuidedResearchVisualStage[];
} {
  return {
    current: nodeToStage[runtime.currentNode],
    available: runtime.availableNodes.map((node) => nodeToStage[node]),
  };
}
