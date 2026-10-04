export const GUIDED_RESEARCH_SIX_STEPS = [
  { id: "import", label: "导入需求" },
  { id: "topic", label: "确认研究主题" },
  { id: "plan", label: "研究计划" },
  { id: "research", label: "资料研究" },
  { id: "chapters", label: "报告章节" },
  { id: "report", label: "生成报告" },
] as const;

export type GuidedResearchVisualStage = (typeof GUIDED_RESEARCH_SIX_STEPS)[number]["id"];
export const GUIDED_RESEARCH_STEPS = [
  { id: "import", label: "确认研究内容" },
  { id: "plan", label: "研究计划" },
  { id: "report", label: "生成报告" },
] as const;
export function canonicalResearchStage(stage: GuidedResearchVisualStage): "import" | "plan" | "report" {
  return stage === "import" ? "import" : stage === "topic" || stage === "plan" ? "plan" : "report";
}
type RuntimeNode = "brief" | "directions" | "outline" | "research" | "report";

const nodeToStage: Record<RuntimeNode, GuidedResearchVisualStage> = {
  brief: "import",
  directions: "plan",
  outline: "plan",
  research: "report",
  report: "report",
};

export function toGuidedResearchVisualStage(runtime: { currentNode: RuntimeNode; availableNodes: readonly RuntimeNode[] }): {
  current: GuidedResearchVisualStage;
  available: GuidedResearchVisualStage[];
} {
  return {
    current: nodeToStage[runtime.currentNode],
    available: Array.from(new Set(runtime.availableNodes.map((node) => nodeToStage[node]))),
  };
}
