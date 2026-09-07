import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { citationHref, researchReferenceUrl, type ReportDocument, type ReportReference } from "@/lib/research-report-document";

export function ResearchReportMarkdown({ text, references }: { text: string; references: ReportReference[] }) {
  return <div className="chat-markdown min-w-0 break-words text-13 leading-7">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml components={{
      a: ({ href, children }) => {
        const citation = references.find((item) => citationHref(item.number) === href);
        if (citation) return <sup className="ml-0.5 align-super text-12 leading-none"><a href={citation.url} target="_blank" rel="noopener noreferrer" title={citation.title} aria-label={`来源 ${citation.number}：${citation.title}`} className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary" data-testid="research-inline-citation">{citation.number}</a></sup>;
        const url = href && researchReferenceUrl(href);
        return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline transition-colors hover:decoration-primary">{children}</a> : <span>{children}</span>;
      },
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="max-w-full overflow-x-auto"><table>{children}</table></div>,
    }}>{text}</ReactMarkdown>
  </div>;
}

export function GuidedResearchReportDocument({ document, provisional = false }: { document: ReportDocument; provisional?: boolean }) {
  return <div className="min-w-0 space-y-6" data-testid={provisional ? "research-report-preview-text" : "research-report-document"}>
    {document.title && <h2 className="text-24 font-semibold tracking-tight">{document.title}</h2>}
    {document.summary && <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-5"><h3 className="text-16 font-semibold">执行摘要</h3><ResearchReportMarkdown text={document.summary} references={document.references} /></section>}
    {document.sections.map((section, index) => <section id={provisional ? undefined : `research-report-section-${index}`} key={`${section.sectionId}-${index}`} className="min-w-0 space-y-3 border-t border-border pt-5" data-testid="research-report-chapter"><h3 className="text-20 font-semibold">{section.title}</h3><ResearchReportMarkdown text={section.body} references={document.references} /></section>)}
    {document.references.length > 0 && <section className="space-y-3 border-t border-border pt-5" aria-label="参考来源" data-testid="research-report-references"><h3 className="text-16 font-semibold">参考来源{provisional ? " · 待最终校验" : ""}</h3><ol className="list-decimal space-y-2 pl-5 text-12 leading-relaxed">{document.references.map((reference) => <li key={reference.number} id={provisional ? undefined : `research-reference-${reference.number}`}><a href={reference.url} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2 transition-colors hover:decoration-primary">{reference.title}</a><p className="break-all text-muted-foreground">{reference.url}</p></li>)}</ol></section>}
  </div>;
}
