// Explicit HTTP provider double for the full-stack research test, never a runtime fallback.
export function guidedResearchReply(system: string, user: string): string | null {
  if (!system.includes("You are a research assistant.")) return null;
  const context = JSON.parse(user);
  const node = system.includes("Create a concrete web research plan") ? "research" : /Generate the (\w+) step/.exec(system)?.[1] ?? context.targetNode;
  let value: unknown = context.brief;
  if (node === "directions") value = [{ id: "d-e2e", title: "并网政策", description: "核对实际并网要求", enabled: true, order: 0 }];
  if (node === "outline") value = [{ id: "o-e2e", title: "并网政策研究", questions: ["政策有哪些要求？"], enabled: true, order: 0 }];
  if (node === "research") value = { tasks: [{ sectionId: "o-e2e", query: "grid storage policy evidence" }] };
  if (node === "report") value = { title: "并网政策报告", summary: "基于本次检索来源形成的测试报告。", sections: [{ sectionId: "o-e2e", body: "测试来源说明了并网政策要求。", sourceIds: context.sources.filter((source: {decision: string}) => source.decision === "accepted").map((source: {id: string}) => source.id) }] };
  if (context.targetNode) value = { assistantMessage: `已根据“${context.instruction}”生成建议。`, value };
  return JSON.stringify(value);
}
