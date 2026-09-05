import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
export function runtimeFixture(node: GuidedResearchRuntime["currentNode"] = "brief", sessionId = "grs-live"): GuidedResearchRuntime {
  const nodes = ["brief", "directions", "outline", "research", "report"] as const;
  return { sessionId, version: 4, revision: 1, currentNode: node, availableNodes: nodes.slice(0,nodes.indexOf(node)+1),
    brief: { topic: "储能研究", goal: "评估进入策略", region: "欧洲", timeRange: "2026", focus: "政策" },
    directions: [{ id: "d1", title: "政策方向", description: "核对政策", enabled: true, order: 0 }],
    outline: [{ id: "o1", title: "政策章节", questions: ["有哪些准入要求？"], enabled: true, order: 0 }],
    tasks: [{ id: "t1", sectionId: "o1", query: "storage grid policy", status: "succeeded", attempts: 1, errorCode: null }],
    sources: [{ id: "source1", taskId: "t1", title: "Official policy", url: "https://example.org/policy", content: "Retrieved evidence", retrievedAt: "2026-09-05", decision: "accepted" }],
    report: node === "report" ? { title: "政策研究报告", summary: "有来源支持的摘要", sections: [{ sectionId: "o1", body: "有来源支持的结论", sourceIds: ["source1"] }] } : null,
    completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: nodes.slice(0,nodes.indexOf(node)+1), messages: [], proposal: null, modelCalls: [],
  };
}
