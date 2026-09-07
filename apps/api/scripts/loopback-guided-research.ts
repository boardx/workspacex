// Explicit HTTP provider double for the full-stack research test, never a runtime fallback.
export function guidedResearchReply(system: string, user: string): string | null {
  if (!system.includes("You are a research assistant.")) return null;
  const context = JSON.parse(user);
  const node = system.includes("Create a concrete web research plan") ? "research" : /Generate the (\w+) step/.exec(system)?.[1] ?? context.targetNode;
  let value: unknown = context.brief;
  if (node === "directions") value = [{ id: "d-e2e", title: "并网政策", description: "核对实际并网要求", enabled: true, order: 0 }];
  if (node === "outline") value = [
    { id: "o-e2e", title: "并网政策研究", questions: ["政策有哪些要求？"], enabled: true, order: 0 },
    { id: "o-e2e-actions", title: "实施路径与风险", questions: ["如何验证项目实施风险？"], enabled: true, order: 1 },
  ];
  if (node === "research") value = { tasks: context.outline.map((section: { id: string }) => ({ sectionId: section.id, query: "grid storage policy evidence" })) };
  if (node === "report" && context.reportStage === "chapter") {
    const id = context.sources[0].id;
    value = { sectionId: context.section.id, body: [
      "### 证据与现状",
      `本章分析${context.section.title}。测试来源说明了并网政策要求，但检索摘要不能代替正式政策全文，因此项目判断需要明确区分已知信息与待核实内容。[[source:${id}]]`,
      "### 影响与限制",
      "政策要求会影响项目接入条件和实施节奏。现有证据尚不足以比较不同地区的具体规则，也无法推断实际审批期限，应将这些问题列入进一步核实范围。",
      "### 建议与验证",
      `建议逐项核对本章研究问题，查阅政策原文并记录适用范围与发布日期，再根据核实结果评估实施风险；本测试材料仅用于验证报告生成链路。[[source:${id}]]`,
    ].join("\n\n"), sourceIds: [id] };
  }
  if (node === "report" && context.reportStage === "synthesis") value = { title: "并网政策报告", summary: "根据各章分析，应先核对政策原文与适用范围，再评估实施风险；检索摘要尚不能支持具体审批时间的判断。" };
  if (context.targetNode) value = { assistantMessage: `已根据“${context.instruction}”生成建议。`, value };
  return JSON.stringify(value);
}
