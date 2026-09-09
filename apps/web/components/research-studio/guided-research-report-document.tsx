import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadResearchWord, printResearchPdf } from "@/lib/research-report-export";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { citationHref, researchReferenceUrl, type ReportDocument, type ReportReference } from "@/lib/research-report-document";

export function ResearchReportMarkdown({ text, references }: { text: string; references: ReportReference[] }) {
  return <div className="chat-markdown min-w-0 break-words text-14 leading-8">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml components={{
      p: ({ children }) => <p className="my-4 leading-8">{children}</p>,
      h1: ({ children }) => <h4 className="mb-3 mt-7 text-18 font-semibold">{children}</h4>,
      h2: ({ children }) => <h4 className="mb-3 mt-7 text-18 font-semibold">{children}</h4>,
      h3: ({ children }) => <h4 className="mb-3 mt-6 text-16 font-semibold">{children}</h4>,
      h4: ({ children }) => <h5 className="mb-2 mt-5 text-14 font-semibold">{children}</h5>,
      li: ({ children }) => <li className="my-2 leading-8">{children}</li>,
      a: ({ href, children }) => {
        const citation = references.find((item) => citationHref(item.number) === href);
        if (citation) return <sup className="ml-0.5 align-super text-11 leading-none"><a href={citation.url} target="_blank" rel="noopener noreferrer" title={citation.title} aria-label={`来源 ${citation.number}：${citation.title}`} className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary" data-testid="research-inline-citation">{citation.number}</a></sup>;
        const url = href && researchReferenceUrl(href);
        return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline transition-colors hover:decoration-primary">{children}</a> : <span>{children}</span>;
      },
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="my-5 max-w-full overflow-x-auto rounded-lg border border-border"><table>{children}</table></div>,
    }}>{text}</ReactMarkdown>
  </div>;
}

function chapterBody(body: string, title: string) {
  const heading = /^\s*#{1,6}\s+([^\n]+)\n+/.exec(body);
  return heading && heading[1]!.trim() === title.trim() ? body.slice(heading[0].length) : body;
}

export function GuidedResearchReportDocument({ document, provisional = false, historical = false, idPrefix = "", limitations }: { document: ReportDocument; provisional?: boolean; historical?: boolean; idPrefix?: string; limitations?: string }) {
  const root = useRef<HTMLElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  async function word() { if (!root.current) return; setExporting(true); setExportError(""); try { await downloadResearchWord(root.current, `${document.title}${provisional ? "-草稿" : ""}`); } catch { setExportError("导出失败，请重试。"); } finally { setExporting(false); } }
  const anchorId = (id: string) => `${idPrefix}${id}`;
  const anchors = [
    ...(document.summary ? [{ id: "research-report-summary", title: "执行摘要" }] : []),
    ...(document.introduction ? [{ id: "research-report-introduction", title: "研究范围与方法" }] : []),
    ...document.sections.map((section, index) => ({ id: `research-report-section-${index}`, title: `${index + 1}. ${section.title}` })),
    ...(document.conclusion ? [{ id: "research-report-conclusion", title: "综合结论" }] : []),
    ...(document.references.length ? [{ id: "research-report-references", title: "参考来源" }] : []),
  ];
  return <div className="space-y-3">{!historical && <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={exporting} onClick={() => void word()}>{exporting ? "正在导出…" : "下载 Word"}</Button><Button variant="outline" onClick={() => { if (root.current) { try { printResearchPdf(root.current); } catch { setExportError("无法打开打印窗口，请重试。"); } } }}>导出 PDF</Button><span className="w-full text-right text-12 text-muted-foreground">PDF 在打印窗口中选择“另存为 PDF”{provisional ? " · 当前导出为未完成草稿" : ""}</span>{exportError && <p role="alert" className="text-12 text-destructive">{exportError}</p>}</div>}<article ref={root} className="mx-auto w-full min-w-0 max-w-4xl space-y-8 rounded-xl border border-border bg-card px-5 py-7 text-card-foreground sm:px-8 sm:py-10" data-testid={anchorId(provisional ? "research-report-preview-text" : "research-report-document")}>
    <header className="space-y-4 border-b border-border pb-6"><p className="text-12 font-medium tracking-wide text-muted-foreground">研究报告{historical ? " · 历史内容（非本轮结果）" : provisional ? " · 草稿" : ""}</p><h2 className="text-24 font-semibold leading-relaxed tracking-tight sm:text-28">{document.title || "研究报告"}</h2>{(provisional || historical) && <p className="text-12 text-muted-foreground">{historical ? "上一轮保存的内容，仅供查看，不属于本轮报告。" : "内容仍在生成或校验中，不代表最终报告。"}</p>}{limitations && <p className="text-12 text-muted-foreground">{limitations}</p>}</header>
    {anchors.length > 0 && <nav aria-label="报告目录" className="rounded-lg bg-muted/30 p-4 sm:p-5"><h3 className="text-14 font-semibold">目录</h3><ol className="mt-3 space-y-2 text-13">{anchors.map((anchor) => <li key={anchor.id}><a href={`#${anchorId(anchor.id)}`} className="text-primary transition-colors hover:underline">{anchor.title}</a></li>)}</ol></nav>}
    {document.summary && <section id={anchorId("research-report-summary")} className="space-y-3 rounded-lg bg-muted/20 p-4 sm:p-5"><h3 className="text-18 font-semibold">执行摘要</h3><ResearchReportMarkdown text={document.summary} references={document.references} /></section>}
    {document.introduction && <section id={anchorId("research-report-introduction")} className="space-y-3" data-testid="research-report-introduction"><h3 className="text-20 font-semibold">研究范围与方法</h3><ResearchReportMarkdown text={document.introduction} references={document.references} /></section>}
    {document.sections.map((section, index) => <section id={anchorId(`research-report-section-${index}`)} key={`${section.sectionId}-${index}`} className="min-w-0 space-y-4 border-t border-border pt-7" data-testid="research-report-chapter"><h3 className="text-20 font-semibold leading-relaxed">{index + 1}. {section.title}</h3><ResearchReportMarkdown text={chapterBody(section.body, section.title)} references={document.references} /></section>)}
    {document.conclusion && <section id={anchorId("research-report-conclusion")} className="space-y-3 border-t border-border pt-7" data-testid="research-report-conclusion"><h3 className="text-20 font-semibold">综合结论</h3><ResearchReportMarkdown text={document.conclusion} references={document.references} /></section>}
    {document.references.length > 0 && <section id={anchorId("research-report-references")} className="space-y-3 border-t border-border pt-7" aria-label="参考来源" data-testid="research-report-references"><h3 className="text-18 font-semibold">参考来源{provisional ? " · 待最终校验" : ""}</h3><ol className="list-decimal space-y-3 pl-5 text-12 leading-relaxed">{document.references.map((reference) => <li key={reference.number} id={anchorId(`research-reference-${reference.number}`)}><a href={reference.url} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2 transition-colors hover:decoration-primary">{reference.title}</a><p className="mt-1 break-all text-muted-foreground">{reference.url}</p></li>)}</ol></section>}
  </article></div>;
}
