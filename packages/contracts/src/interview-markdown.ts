import { z } from "zod";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { DigitalInterviewArtifact, DigitalInterviewArtifactStep, InterviewError, operations } from "./interview";
import { InterviewMarkdownReportReview } from "./interview-markdown-report-review";

/** Offsets use JavaScript UTF-16 code units into the preserved runs Markdown. */
export const InterviewAnswerSpan = z.object({
  taskKey: z.string().min(1), expertId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().refine(span => span.end > span.start, "answer span must be nonempty");
export const InterviewEvidenceLocator = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  quote: z.string().min(1), taskKey: z.string().nullable(), expertId: z.string().nullable(),
  evidenceMode: DigitalInterviewArtifact.innerType().shape.evidenceMode,
}).strict().refine(locator => locator.end > locator.start, "locator must be nonempty");

/** Research body is kept verbatim; references are controlled metadata, not model claims. */
export const InterviewMarkdownDocument = z.object({
  documentId: z.string().min(1).refine((value) => value.trim().length > 0, "documentId cannot be blank"),
  step: DigitalInterviewArtifactStep,
  version: z.number().int().positive(),
  markdown: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evidenceMode: DigitalInterviewArtifact.innerType().shape.evidenceMode,
  references: z.array(z.object({
    anchor: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u),
    documentId: z.string().min(1).refine((value) => value.trim().length > 0, "documentId cannot be blank"),
    version: z.number().int().positive(),
    locator: InterviewEvidenceLocator.optional(),
  }).strict()),
  answerSpans: z.array(InterviewAnswerSpan).optional(),
}).strict().superRefine((document, context) => {
  const anchors = new Set<string>();
  document.references.forEach((reference, index) => {
    if (anchors.has(reference.anchor)) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["references", index, "anchor"],
      message: "reference anchors must be unique",
    });
    anchors.add(reference.anchor);
  });
});
export type InterviewMarkdownDocument = z.infer<typeof InterviewMarkdownDocument>;

export type InterviewReportAnalysisGap = "cross_answer_synthesis" | "decision_implication" | "boundary_or_counterevidence" | "verifiable_action";
export type InterviewReportAnalysisAssessment = { readonly ok: boolean; readonly missing: readonly InterviewReportAnalysisGap[] };
const REPORT_SYNTHESIS_SIGNALS = [/跨(?:回答|受访者|角色|专家|样本)(?:综合|归纳|分析|比较)/u, /共同(?:模式|主题|约束|需求|指向)/u, /(?:多位|两位|不同)(?:受访者|专家|角色).{0,24}(?:共同|一致|差异|分歧|互补)/u];
const REPORT_DECISION_SIGNALS = [/决策影响(?:[：:]|[。.]|$)/mu, /(?:优先级|优先验证|应优先|暂缓|停止|继续|选择).{0,36}(?:因为|基于|依据|验证|行动|方案|投入)/u, /P[012][：:]/u, /成功信号(?:[：:]|[。.]|$)/mu];
// Boundary evidence must be an explicit report line, not incidental prose such as
// “the answers differ”. Requiring line-start structure prevents transcript-like
// reports from passing solely because they contain a generic “反例/边界” mention.
const REPORT_BOUNDARY_SIGNALS = [
  /边界与反例(?:[：:。.]|$)/u,
  /^\s*(?:边界(?:与反例)?|反例(?:与边界)?|反对证据|相反证据|负面案例)(?:[：:。.]|$)/mu,
  /^\s*(?:置信度|适用范围|样本边界|仍待验证|尚待验证|不能判断)(?:[：:。.]|$)/mu,
  /(?:置信度|适用范围|样本边界|仍待验证|尚待验证)(?:为|是|需|仍)/u,
];
const REPORT_ACTION_SIGNALS = [
  /(?:下一步验证建议|建议行动|行动建议|验证计划)(?:[：:]|[。.]|$)[ \t]*\S{8,}.{0,240}/mu,
  /P[012][：:][ \t]*\S/u,
  /决策影响[：:][ \t]*(?:应|需|建议|优先|可)[ \t]*\S{4,}/mu,
  /(?:优先验证|可验证).{0,36}(?:行动|假设|方案|指标|路径)/u,
];
const reportHasAny = (markdown: string, patterns: readonly RegExp[]) => patterns.some((pattern) => pattern.test(markdown));
export function assessInterviewReportAnalysis(markdown: string): InterviewReportAnalysisAssessment {
  const text = reportAnalysisText(markdown);
  const missing: InterviewReportAnalysisGap[] = [];
  if (!reportHasAny(text, REPORT_SYNTHESIS_SIGNALS)) missing.push("cross_answer_synthesis");
  if (!reportHasAny(text, REPORT_DECISION_SIGNALS)) missing.push("decision_implication");
  if (!reportHasAny(text, REPORT_BOUNDARY_SIGNALS)) missing.push("boundary_or_counterevidence");
  if (!hasInterviewReportVerifiableAction(markdown)) missing.push("verifiable_action");
  return { ok: missing.length === 0, missing };
}
/** Normalize only explicit heading decorations; never rewrite the report itself. */
function isVerifiableActionHeading(text: string): boolean {
  const label = text.trim().replace(/^(?:\d+[.．、]|[一二三四五六七八九十百]+[、.．])\s*/u, "");
  return /^(?:下一步验证建议|建议行动|行动建议|验证计划)(?:（[^（）()\r\n]{1,40}）|\([^（）()\r\n]{1,40}\))?[：:]?$/u.test(label);
}

/** Quoted examples cannot supply an action, including a P0 label inside a quote. */
function actionNodeText(node: MarkdownNode): string {
  if (["blockquote", "html", "code", "inlineCode", "image"].includes(node.type)) return "";
  if (node.type == "link" && /^#(?:answer-|source-)/u.test(node.url ?? "")) return "";
  const separator = ["list", "listItem", "root"].includes(node.type) ? "\n" : "";
  return node.value ?? node.children?.map(actionNodeText).filter(Boolean).join(separator) ?? "";
}
function hasConcreteVerifiableAction(line: string): boolean {
  const action = line.trim();
  return action.length >= 8 && !/^(?:不应|无需|不要|禁止|不必)/u.test(action)
    && /(?:访谈|测试|验证|观察|测量|对比|监控|采集)/u.test(action)
    && /(?:指标|信号|样本|用户|任务|假设|率|时长|次数|角色|证据)/u.test(action)
    && /(?:对照组|实验组|三角|三方|独立|指标|信号|假设|[一二三四五六七八九十\d]+(?:次|起|位|人|天|周|月)|时长|率)/u.test(action);
}
export function hasInterviewReportVerifiableAction(markdown: string): boolean {
  const nodes = (parser.parse(markdown) as MarkdownNode).children ?? [];
  // Inline labels use the same substantive check as section content, not a keyword shortcut.
  if (nodes.filter(node => node.type !== "heading").flatMap(node => actionNodeText(node).split("\n"))
    .some(line => reportHasAny(line, REPORT_ACTION_SIGNALS) && hasConcreteVerifiableAction(line))) return true;
  return nodes.some((node, index) => {
    if (node.type !== "heading" || !isVerifiableActionHeading(analysisNodeText(node))) return false;
    const following: string[] = [];
    for (const next of nodes.slice(index + 1)) {
      if (next.type === "heading" && (next.depth ?? 0) <= (node.depth ?? 0)) break;
      following.push(actionNodeText(next));
    }
    return following.join("\n").split("\n").some(hasConcreteVerifiableAction);
  });
}

export const InterviewMarkdownExecution = z.object({
  status: z.enum(["running", "paused", "failed", "completed"]),
  tasks: z.array(z.object({
    expertId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
    status: z.enum(["pending", "running", "failed", "completed"]),
    errorCode: z.string().nullable(),
  }).strict()),
}).strict();
export const ExecuteInterviewMarkdown = z.object({
  expectedVersion: z.number().int().positive(),
  action: z.enum(["start", "advance", "pause", "resume", "retry"]),
}).strict();
export const BranchInterviewMarkdownRevision = z.object({
  expectedVersion:z.number().int().positive(),
  fromStep:z.enum(["intake","analysis","experts","outline"]),
}).strict();
export const InterviewMarkdownOriginalAttachment=z.object({assetId:z.string().min(1),filename:z.string().min(1).max(255),mime:z.string().min(1),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/u)}).strict();

export const InterviewMarkdownEnvelope = z.object({
  interviewId: z.string().min(1),
  revisionId: z.string().min(1).nullable(),
  version: z.number().int().positive(),
  documents: z.array(InterviewMarkdownDocument),
  states: z.array(z.object({
    documentId: z.string().min(1),
    status: DigitalInterviewArtifact.innerType().shape.status,
    failure: DigitalInterviewArtifact.innerType().shape.failure,
  }).strict()),
  execution: InterviewMarkdownExecution.nullable().default(null),
  review: InterviewMarkdownReportReview.nullable().default(null),
}).strict();
/** Request-local observation; completed is emitted only after authorized canonical storage/read. */
export const InterviewReportRejectionCode = z.enum(["REPORT_ACTION_VALIDATION_REJECTED", "REPORT_QUALITY_REJECTED", "REPORT_GROUNDING_REJECTED"]);
export type InterviewReportRejectionCode = z.infer<typeof InterviewReportRejectionCode>;

const interviewOperationErrors = Object.values(operations).flatMap(operation => [...operation.err]);
export const InterviewMarkdownReportFailureCode = z.enum([...InterviewError.options, ...InterviewReportRejectionCode.options, ...interviewOperationErrors]);

export const InterviewMarkdownReportStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attempt"), attempt: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("stage"), stage: z.enum(["context", "model", "validation", "storage"]) }).strict(),
  z.object({ type: z.literal("delta"), delta: z.string() }).strict(),
  z.object({ type: z.literal("completed"), source: InterviewMarkdownEnvelope }).strict(),
  z.object({ type: z.literal("failed"), reasonCode: InterviewMarkdownReportFailureCode }).strict(),
]);
export type InterviewMarkdownReportStreamEvent = z.infer<typeof InterviewMarkdownReportStreamEvent>;

export const InterviewMarkdownAttachmentResult=z.object({source:InterviewMarkdownEnvelope,original:InterviewMarkdownOriginalAttachment}).strict();

/** Read-only navigation/history projection; confirmation comes exclusively from metadata. */
export function projectInterviewMarkdownProgress(source: z.infer<typeof InterviewMarkdownEnvelope>) {
  const statusOf=(step:InterviewMarkdownDocument["step"])=>{
    const doc=source.documents.find(document=>document.step===step);
    return source.states.find(state=>state.documentId===doc?.documentId)?.status;
  };
  const confirmed=(step:InterviewMarkdownDocument["step"])=>["confirmed","completed"].includes(statusOf(step)??"");
  const order=["report","runs","outline","experts","analysis","intake"] as const;
  const failed=order.find(step=>statusOf(step)==="failed");
  if(failed) return {step:failed,status:"failed" as const};
  if(source.execution?.status==="failed") return {step:"runs" as const,status:"failed" as const};
  if(source.documents.some(doc=>doc.step==="report") && (source.execution?.status==="completed" || confirmed("runs"))) return {step:"report" as const,status:"completed" as const};
  if(source.execution?.status==="completed" || confirmed("runs")) return {step:"runs" as const,status:"report_pending" as const};
  if(source.execution) return {step:"runs" as const,status:"running" as const};
  if(confirmed("outline")) return {step:"runs" as const,status:"questions_pending" as const};
  if(source.documents.some(doc=>doc.step==="outline") || confirmed("experts")) return {step:"outline" as const,status:"questions_pending" as const};
  if(source.documents.some(doc=>doc.step==="experts") || confirmed("analysis")) return {step:"experts" as const,status:"experts_pending" as const};
  if(source.documents.some(doc=>doc.step==="analysis") || confirmed("intake")) return {step:"analysis" as const,status:"topic_pending" as const};
  return {step:"intake" as const,status:"draft" as const};
}

export function projectInterviewMarkdownExperts(document:InterviewMarkdownDocument) {
  return parseInterviewMarkdown(document).blocks.flatMap(block=>{
    const link=block.links.find(item=>/^#expert-[a-zA-Z0-9_-]+$/u.test(item.url));
    return link?[{expertId:link.url.slice(8),displayName:link.text,headingId:block.headingId}]:[];
  });
}

/** Draft editing cannot set evidence, confirmation, references, or approval metadata. */
export const SaveInterviewMarkdownDraft = z.object({
  markdown: z.string().refine((value) => value.trim().length > 0, "Markdown cannot be blank"),
  expectedVersion: z.number().int().positive(),
  expectedDocumentVersion: z.number().int().nonnegative(),
}).strict();

export const InterviewMarkdownGenerationStep = z.enum(["analysis", "experts", "outline", "report"]);
export const GenerateInterviewMarkdown = SaveInterviewMarkdownDraft.omit({ markdown: true });
export const PreviewVirtualExpertMarkdown = z.object({
  description: z.string().trim().min(1).max(1000),
  expectedVersion: z.number().int().positive(),
}).strict();
export const VirtualExpertMarkdownProposal = z.object({ markdown: z.string().min(20).max(8000) }).strict();
export const InitializeInterviewMarkdown = GenerateInterviewMarkdown.omit({ expectedDocumentVersion: true });
export const ConfirmInterviewMarkdown = GenerateInterviewMarkdown.extend({
  expectedDocumentVersion: z.number().int().positive(),
});

export type InterviewMarkdownProjection = Readonly<{
  evidenceMode: InterviewMarkdownDocument["evidenceMode"];
  headings: readonly Readonly<{ id: string; depth: number; text: string }>[];
  sections: readonly Readonly<{ headingId: string | null; text: string }>[];
  entries: readonly Readonly<{ headingId: string | null; text: string; listDepth: number }>[];
  anchors: readonly Readonly<InterviewMarkdownDocument["references"][number]>[];
  blocks: readonly Readonly<{ headingId: string; depth: number; title: string; start: number; contentStart: number; end: number; links: readonly Readonly<{ text: string; url: string }>[] }>[];
}>;

const parser = unified().use(remarkParse).use(remarkGfm);
type MarkdownNode = { type: string; value?: string; depth?: number; url?: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: MarkdownNode[] };

/** Quality checks read visible prose, never code examples, HTML or link URLs. */
function analysisNodeText(node: MarkdownNode): string {
  if (["html", "code", "inlineCode", "image"].includes(node.type)) return "";
  const separator = ["list", "listItem", "root", "blockquote"].includes(node.type) ? "\n" : "";
  return node.value ?? node.children?.map(analysisNodeText).filter(Boolean).join(separator) ?? "";
}
function reportAnalysisText(markdown: string): string {
  const nodes = (parser.parse(markdown) as MarkdownNode).children ?? [];
  return nodes.filter((node, index) => {
    if (node.type !== "heading") return true;
    // A label alone is not analysis. Include a heading only when its section
    // contains prose; code examples and empty child headings do not count.
    for (const next of nodes.slice(index + 1)) {
      if (next.type === "heading" && (next.depth ?? 0) <= (node.depth ?? 0)) break;
      if (next.type !== "heading" && analysisNodeText(next).trim()) return true;
    }
    return false;
  }).map(analysisNodeText).filter(Boolean).join("\n");
}

function plainText(node: MarkdownNode): string {
  if (node.type === "html") return "";
  const separator = ["list", "listItem", "root", "blockquote"].includes(node.type) ? "\n" : "";
  return node.value ?? node.children?.map(plainText).filter(Boolean).join(separator) ?? "";
}

/** Display-only AST projection. Never grants authorization or rewrites the original body. */
export function parseInterviewMarkdown(input: InterviewMarkdownDocument): InterviewMarkdownProjection {
  const document = InterviewMarkdownDocument.parse(input);
  const tree: MarkdownNode = parser.parse(document.markdown);
  const headings: { id: string; depth: number; text: string }[] = [];
  const sections: { headingId: string | null; text: string }[] = [];
  const entries: { headingId: string | null; text: string; listDepth: number }[] = [];
  const blocks: { headingId: string; depth: number; title: string; start: number; contentStart: number; end: number; links: readonly Readonly<{ text: string; url: string }>[] }[] = [];
  let headingId: string | null = null;
  let sectionText: string[] = [];
  function finishSection(): void {
    if (headingId !== null || sectionText.length) sections.push({ headingId, text: sectionText.join("\n\n") });
    sectionText = [];
  }
  // Nested headings are content of their enclosing block, not document sections.
  function visit(node: MarkdownNode, topLevel = false, listDepth = 0): void {
    if (topLevel && node.type === "heading") {
      finishSection();
      headingId = `section-${headings.length + 1}`;
      headings.push({ id: headingId, depth: node.depth!, text: plainText(node) });
      const start = node.position?.start.offset ?? 0;
      const links: { text: string; url: string }[] = [];
      function collectLinks(child: MarkdownNode): void {
        if (child.type === "link" && child.url) links.push({ text: plainText(child), url: child.url });
        child.children?.forEach(collectLinks);
      }
      collectLinks(node);
      blocks.push({ headingId, depth: node.depth!, title: plainText(node), start, contentStart: node.position?.end.offset ?? start,
        end: document.markdown.length, links: Object.freeze(links.map((link) => Object.freeze(link))) });
    }
    if (node.type === "listItem") entries.push({ headingId, text: plainText(node), listDepth });
    node.children?.forEach((child) => visit(child, false, node.type === "list" ? listDepth + 1 : listDepth));
  }
  for (const node of tree.children ?? []) {
    visit(node, true);
    if (node.type !== "heading") {
      const text = plainText(node);
      if (text) sectionText.push(text);
    }
  }
  finishSection();
  for (const [index, block] of blocks.entries()) {
    block.end = blocks.slice(index + 1).find((next) => next.depth <= block.depth)?.start ?? document.markdown.length;
  }
  return Object.freeze({
    evidenceMode: document.evidenceMode,
    headings: Object.freeze(headings.map((heading) => Object.freeze(heading))),
    sections: Object.freeze(sections.map((section) => Object.freeze(section))),
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    anchors: Object.freeze(document.references.map((reference) => Object.freeze({ ...reference }))),
    blocks: Object.freeze(blocks.map((block) => Object.freeze(block))),
  });
}

/** Parse explicit Markdown citations, excluding escaped syntax and code examples. */
export function parseInterviewEvidenceLinks(markdown: string): ReadonlyArray<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  function visit(node: MarkdownNode): void {
    if (node.type === "link" && node.url) links.push({text: plainText(node), url: node.url});
    node.children?.forEach(visit);
  }
  visit(parser.parse(markdown) as MarkdownNode);
  return links;
}

/** Visible prose excludes links/code. Default cell scope binds attribution; row grouping is quality-only. */
export function parseInterviewReportAssertions(markdown: string, options: {groupTableRows?: boolean} = {}): ReadonlyArray<{text:string;links:ReadonlyArray<{text:string;url:string}>}> {
  const assertions: Array<{text:string;links:Array<{text:string;url:string}>}> = [];
  function prose(node:MarkdownNode):string {
    if (["link","code","inlineCode","html","image"].includes(node.type)) return "";
    return node.value ?? node.children?.map(prose).join("") ?? "";
  }
  function visit(node:MarkdownNode):void {
    if (["paragraph", "heading", options.groupTableRows ? "tableRow" : "tableCell"].includes(node.type)) {
      const links:Array<{text:string;url:string}>=[];
      function collect(child:MarkdownNode):void {
        if(child.type==="link"&&child.url) links.push({text:plainText(child),url:child.url});
        child.children?.forEach(collect);
      }
      collect(node); assertions.push({text:node.type === "tableRow" ? node.children?.map(prose).join("：") ?? "" : prose(node),links});
    } else node.children?.forEach(visit);
  }
  visit(parser.parse(markdown) as MarkdownNode);
  return assertions;
}
