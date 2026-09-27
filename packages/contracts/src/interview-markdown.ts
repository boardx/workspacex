import { z } from "zod";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { DigitalInterviewArtifact, DigitalInterviewArtifactStep } from "./interview";

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
}).strict();

/** Draft editing cannot set evidence, confirmation, references, or approval metadata. */
export const SaveInterviewMarkdownDraft = z.object({
  markdown: z.string().refine((value) => value.trim().length > 0, "Markdown cannot be blank"),
  expectedVersion: z.number().int().positive(),
  expectedDocumentVersion: z.number().int().nonnegative(),
}).strict();

export const InterviewMarkdownGenerationStep = z.enum(["analysis", "experts", "outline", "report"]);
export const GenerateInterviewMarkdown = SaveInterviewMarkdownDraft.omit({ markdown: true });
export const ConfirmInterviewMarkdown = GenerateInterviewMarkdown.extend({
  expectedDocumentVersion: z.number().int().positive(),
});

export type InterviewMarkdownProjection = Readonly<{
  evidenceMode: InterviewMarkdownDocument["evidenceMode"];
  headings: readonly Readonly<{ id: string; depth: number; text: string }>[];
  sections: readonly Readonly<{ headingId: string | null; text: string }>[];
  entries: readonly Readonly<{ headingId: string | null; text: string }>[];
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
  const entries: { headingId: string | null; text: string }[] = [];
  const blocks: { headingId: string; depth: number; title: string; start: number; contentStart: number; end: number; links: readonly Readonly<{ text: string; url: string }>[] }[] = [];
  let headingId: string | null = null;
  let sectionText: string[] = [];
  function finishSection(): void {
    if (headingId !== null || sectionText.length) sections.push({ headingId, text: sectionText.join("\n\n") });
    sectionText = [];
  }
  // Nested headings are content of their enclosing block, not document sections.
  function visit(node: MarkdownNode, topLevel = false): void {
    if (topLevel && node.type === "heading") {
      finishSection();
      headingId = `section-${headings.length + 1}`;
      headings.push({ id: headingId, depth: node.depth!, text: plainText(node) });
      const start = node.position?.start.offset ?? 0;
      if (blocks.length) blocks[blocks.length - 1]!.end = start;
      const links: { text: string; url: string }[] = [];
      function collectLinks(child: MarkdownNode): void {
        if (child.type === "link" && child.url) links.push({ text: plainText(child), url: child.url });
        child.children?.forEach(collectLinks);
      }
      collectLinks(node);
      blocks.push({ headingId, depth: node.depth!, title: plainText(node), start, contentStart: node.position?.end.offset ?? start,
        end: document.markdown.length, links: Object.freeze(links.map((link) => Object.freeze(link))) });
    }
    if (node.type === "listItem") entries.push({ headingId, text: plainText(node) });
    node.children?.forEach((child) => visit(child));
  }
  for (const node of tree.children ?? []) {
    visit(node, true);
    if (node.type !== "heading") {
      const text = plainText(node);
      if (text) sectionText.push(text);
    }
  }
  finishSection();
  return Object.freeze({
    evidenceMode: document.evidenceMode,
    headings: Object.freeze(headings.map((heading) => Object.freeze(heading))),
    sections: Object.freeze(sections.map((section) => Object.freeze(section))),
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    anchors: Object.freeze(document.references.map((reference) => Object.freeze({ ...reference }))),
    blocks: Object.freeze(blocks.map((block) => Object.freeze(block))),
  });
}
