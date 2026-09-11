// Explicit HTTP provider double for the full-stack research test, never a runtime fallback.
export function guidedResearchReply(system: string, user: string): string | null {
  if (!system.includes("You are a research assistant.")) return null;
  const context = JSON.parse(user);
  if (context.researchStage === "source_relevance") return JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; content: string; questionIds: string[] }) => {
    const irrelevant = chunk.content.includes("Controlled unrelated vehicle inventory");
    return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant,
      matches: irrelevant ? [] : chunk.questionIds.map((questionId) => ({ questionId, quote: chunk.content.slice(0, 500), insight: "受控测试摘要提供该任务的政策证据。", relevance: "direct" })) };
  }) });
  const node = system.includes("Create a concrete web research plan") ? "research" : /Generate the (\w+) step/.exec(system)?.[1] ?? context.targetNode;
  let value: unknown = context.brief;
  if (node === "directions") value = [{ id: "d-e2e", title: "并网政策", description: "核对实际并网要求", enabled: true, order: 0 }];
  if (node === "outline") value = [
    { id: "o-e2e", title: "并网政策研究", questions: ["政策有哪些要求？"], enabled: true, order: 0 },
    { id: "o-e2e-actions", title: "实施路径与风险", questions: ["如何验证项目实施风险？"], enabled: true, order: 1 },
  ];
  if (node === "directions") value = (value as Array<Record<string, unknown>>).map((item) => ({ ...item,
    decisionQuestions: ["哪些并网要求影响进入决策？"], hypotheses: ["待验证：并网要求可能影响项目实施时间"],
    comparisonDimensions: ["适用范围、接入条件与实施时间"], evidenceNeeds: ["现行政策原文及适用范围"] }));
  if (node === "outline") value = (value as Array<Record<string, unknown>>).map((item) => ({ ...item,
    objective: "明确政策约束对进入决策的影响", analysisApproach: "比较适用范围并区分已证实要求与缺口", expectedOutput: "带证据局限的实施建议",
    subsections: ["Evidence", "Analysis", "Recommendations"].map((title, index) => ({ id: `${item.id}-${index}`, title, questions: [["政策证据说明什么？"], ["对项目有什么影响？"], ["下一步需要验证什么？"]][index] })) }));
  if (node === "research") value = { overview: "核对并网政策与执行差异", optimizedQuestion: "哪些并网政策证据支持进入决策？", tasks: context.outline.map((section: { id: string }) => ({ sectionId: section.id, title: "核对政策证据", objective: "比较官方并网政策与实际执行", deliverables: ["政策依据和执行限制"], query: "grid storage policy evidence" })) };
  if (node === "report" && ["chapter", "chapter_revision"].includes(context.reportStage)) {
    const id = context.sources[0].alias ?? context.sources[0].id;
    value = { sectionId: context.section.id, body: [
      "### Evidence",
      `本章分析${context.section.title}。测试来源说明了并网政策要求，但检索摘要不能代替正式政策全文，因此项目判断需要明确区分已知信息与待核实内容。[[source:${id}]]`,
      "### Analysis",
      "政策要求会影响项目接入条件和实施节奏。现有证据尚不足以比较不同地区的具体规则，也无法推断实际审批期限，应将这些问题列入进一步核实范围。",
      "### Recommendations",
      `建议逐项核对本章研究问题，查阅政策原文并记录适用范围与发布日期，再根据核实结果评估实施风险；本测试材料仅用于验证报告生成链路。[[source:${id}]]`,
    ].join("\n\n"), sourceIds: [id] };
  }
  if (node === "report" && ["chapter", "chapter_revision"].includes(context.reportStage) && context.instruction === "e2e-quality-draft" && context.section.id === "o-e2e") (value as { body: string }).body += "\n\nE2E 待核验章节。";
  if (node === "report" && ["synthesis", "synthesis_revision"].includes(context.reportStage)) value = { introduction: "本研究核对已确认范围内的政策证据，依据检索摘要比较政策要求及实施约束，并说明尚未覆盖的政策原文与审批数据。", conclusion: "综合各章，应优先核验目标地区接入条件，再比较进入方案。后续补充政策原文与审批数据，以判断实施周期和风险。", title: "并网政策报告", summary: "根据各章分析，应先核对政策原文与适用范围，再评估实施风险；检索摘要尚不能支持具体审批时间的判断。" };
  if (node === "report" && ["evidence", "evidence_revision"].includes(context.reportStage)) value = { evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; content: string }) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false, matches: context.questions.map((question: { id: string }) => ({ questionId: question.id, quote: chunk.content.slice(0, 500), insight: "测试摘要说明并网政策证据，具体适用范围仍需核实。", relevance: "direct" })) })) };
  // Exercise automatic evidence repair through HTTP in the five-step full-stack scenario.
  if (node === "report" && context.reportStage === "evidence" && context.brief?.goal === "核对储能并网政策") {
    value = { evaluations: [{ sourceId: "unknown-e2e-source", chunkId: context.chunks[0].chunkId, irrelevant: true, matches: [] }] };
  }
  if (node === "report" && context.reportStage === "quality") value = { questions: context.evidenceByQuestion.map((question: { questionId: string; gap: boolean }) => ({ questionId: question.questionId, status: question.gap ? "gap" : "answered", rationale: "章节包含证据局限、影响分析与验证建议。" })), supported: true, analysisDepth: "adequate", issues: [] };
  if (node === "report" && context.reportStage === "quality" && context.chapter.body.includes("E2E 待核验章节")) Object.assign(value as object, { analysisDepth: "shallow", issues: ["需要补充政策适用范围证据"] });
  if (context.targetNode) value = { assistantMessage: `已根据“${context.instruction}”生成建议。`, value };
  return JSON.stringify(value);
}
