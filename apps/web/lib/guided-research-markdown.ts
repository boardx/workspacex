import type {
  GuidedResearchBrief,
  GuidedResearchDirection,
  GuidedResearchOutlineSection,
  GuidedResearchReport,
  GuidedResearchSource,
  GuidedResearchTask,
} from "./guided-research-api";

type MarkdownNode = "brief" | "directions" | "outline" | "research" | "report";
type Evidence = { questionId: string; sectionId: string; sourceId: string; quote: string; relevance: "direct" | "context" };

export type GuidedResearchMarkdownProvenance = {
  sourceIds: string[];
  citationIds: string[];
};

export type GuidedResearchMarkdownDocument = {
  node: MarkdownNode;
  title: string;
  markdown: string;
  provenance: GuidedResearchMarkdownProvenance;
};

export type GuidedResearchMarkdownInput =
  | { node: "brief"; brief: Pick<GuidedResearchBrief, "topic" | "goal" | "timeRange" | "region" | "focus"> }
  | { node: "directions"; directions: GuidedResearchDirection[] }
  | { node: "outline"; outline: GuidedResearchOutlineSection[] }
  | { node: "research"; brief: Pick<GuidedResearchBrief, "topic">; tasks: GuidedResearchTask[]; sources: GuidedResearchSource[]; evidence: Evidence[] }
  | { node: "report"; report: GuidedResearchReport };

export type GuidedResearchMarkdownError = {
  code: "required_heading" | "immutable_provenance" | "immutable_citation";
  heading?: string;
  message: string;
};

export type GuidedResearchMarkdownParseResult =
  | { ok: true; draft: { node: "brief"; value: Pick<GuidedResearchBrief, "topic" | "goal" | "timeRange" | "region" | "focus"> } }
  | { ok: false; markdown: string; errors: GuidedResearchMarkdownError[] };

export type GuidedResearchMarkdownParseInput = {
  document: GuidedResearchMarkdownDocument;
  markdown: string;
};

const briefHeadings = ["研究主题", "研究目标", "时间与地区", "重点关注"] as const;

function section(markdown: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`(?:^|\\n)## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[1]?.trim() || null;
}

function sourceIds(markdown: string): string[] {
  return [...markdown.matchAll(/\[source:([^\]]+)\]/g)].map((match) => match[1]!).sort();
}

function citationIds(markdown: string): string[] {
  return [...markdown.matchAll(/\[\[source:([^\]]+)\]\]/g)].map((match) => match[1]!).sort();
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function serializeGuidedResearchMarkdown(input: GuidedResearchMarkdownInput): GuidedResearchMarkdownDocument {
  if (input.node === "brief") {
    const { brief } = input;
    return {
      node: "brief",
      title: "研究需求",
      markdown: `# 研究需求\n\n## 研究主题\n${brief.topic}\n\n## 研究目标\n${brief.goal}\n\n## 时间与地区\n时间范围：${brief.timeRange}\n研究地区：${brief.region}\n\n## 重点关注\n${brief.focus}`,
      provenance: { sourceIds: [], citationIds: [] },
    };
  }

  if (input.node === "directions") {
    const directions = input.directions
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((item, index) => `## ${index + 1}. ${item.title}${item.enabled ? "" : "（未纳入）"}\n${item.description}${item.decisionQuestions?.length ? `\n\n### 决策问题\n${item.decisionQuestions.map((question) => `- ${question}`).join("\n")}` : ""}${item.hypotheses?.length ? `\n\n### 待验证假设\n${item.hypotheses.map((hypothesis) => `- ${hypothesis}`).join("\n")}` : ""}`)
      .join("\n\n");
    return {
      node: "directions",
      title: "研究主题",
      markdown: `# 研究主题\n\n${directions || "暂无已生成的研究主题"}`,
      provenance: { sourceIds: [], citationIds: [] },
    };
  }

  if (input.node === "outline") {
    const sections = input.outline
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((item, index) => `## ${index + 1}. ${item.title}${item.enabled ? "" : "（未纳入）"}\n${item.objective ? `目标：${item.objective}\n\n` : ""}### 核心问题\n${item.questions.map((question) => `- ${question}`).join("\n")}${item.analysisApproach ? `\n\n### 分析方法\n${item.analysisApproach}` : ""}${item.expectedOutput ? `\n\n### 预期产出\n${item.expectedOutput}` : ""}${item.subsections?.length ? `\n\n### 子章节\n${item.subsections.map((section) => `- ${section.title}：${section.questions.join("；")}`).join("\n")}` : ""}`)
      .join("\n\n");
    return {
      node: "outline",
      title: "研究计划",
      markdown: `# 研究计划\n\n${sections || "暂无已生成的研究计划"}`,
      provenance: { sourceIds: [], citationIds: [] },
    };
  }

  if (input.node === "research") {
    const sourceIds = input.sources.map((item) => item.id).sort();
    const evidenceLines = input.evidence.map((item) => `- [source:${item.sourceId}] ${item.quote}`).join("\n") || "- 暂无已验证证据";
    const taskLines = input.tasks.map((task) => `- ${task.status === "succeeded" ? "已完成" : task.status === "failed" ? "失败" : "进行中"}：${task.query}`).join("\n") || "- 暂无检索任务";
    return {
      node: "research",
      title: "资料研究",
      markdown: `# 资料研究\n\n## 研究主题\n${input.brief.topic}\n\n## 研究任务\n${taskLines}\n\n## 已验证证据\n${evidenceLines}\n\n## 研究者笔记\n`,
      provenance: { sourceIds, citationIds: [] },
    };
  }

  const sections = input.report.sections.map((item) => `## ${item.sectionId}\n${item.body}`).join("\n\n");
  const markdown = `# ${input.report.title}\n\n## 执行摘要\n${input.report.summary}\n\n## 引言\n${input.report.introduction ?? ""}\n\n${sections}\n\n## 结论\n${input.report.conclusion ?? ""}`;
  return {
    node: "report",
    title: input.report.title,
    markdown,
    provenance: { sourceIds: [], citationIds: citationIds(markdown) },
  };
}

export function parseGuidedResearchMarkdown(input: GuidedResearchMarkdownParseInput): GuidedResearchMarkdownParseResult {
  const { document, markdown } = input;
  if (document.node === "research" && !sameIds(sourceIds(markdown), document.provenance.sourceIds)) {
    return { ok: false, markdown, errors: [{ code: "immutable_provenance", message: "来源标识由已验证证据管理，不能在 Markdown 中修改。" }] };
  }
  if (document.node === "report" && !sameIds(citationIds(markdown), document.provenance.citationIds)) {
    return { ok: false, markdown, errors: [{ code: "immutable_citation", message: "报告引用必须保留已验证的来源标识。" }] };
  }
  if (document.node !== "brief") {
    return { ok: false, markdown, errors: [{ code: "required_heading", message: "此阶段的 Markdown 仅支持在专用编辑器中保存。" }] };
  }

  const values = Object.fromEntries(briefHeadings.map((heading) => [heading, section(markdown, heading)]));
  const missing = briefHeadings.filter((heading) => !values[heading]);
  if (missing.length) {
    return {
      ok: false,
      markdown,
      errors: missing.map((heading) => ({ code: "required_heading", heading, message: `缺少必填章节：${heading}` })),
    };
  }
  const timeframe = values["时间与地区"]!;
  const timeMatch = timeframe.match(/^时间范围：(.*)$/m);
  const regionMatch = timeframe.match(/^研究地区：(.*)$/m);
  const timeRange = timeMatch ? timeMatch[1]!.trim() : undefined;
  const region = regionMatch ? regionMatch[1]!.trim() : undefined;
  if (timeRange === undefined || region === undefined) {
    return { ok: false, markdown, errors: [{ code: "required_heading", heading: "时间与地区", message: "时间与地区必须包含时间范围和研究地区。" }] };
  }
  return {
    ok: true,
    draft: {
      node: "brief",
      value: {
        topic: values["研究主题"]!,
        goal: values["研究目标"]!,
        timeRange,
        region,
        focus: values["重点关注"]!,
      },
    },
  };
}
