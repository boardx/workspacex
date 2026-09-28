import { z } from "zod";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { DigitalInterviewArtifact, DigitalInterviewArtifactStep } from "./interview";
import { InterviewMarkdownReportReview } from "./interview-markdown-report-review";

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
  }).strict()),
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
  description: z.string().trim().min(20).max(1000),
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
