import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadResearchWord, printResearchPdf } from "@/lib/research-report-export";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { citationHref, researchReferenceUrl, type ReportDocument, type ReportReference } from "@/lib/research-report-document";

export function ResearchReportMarkdown({ text, references }: { text: string; references: ReportReference[] }) {
  return <div className="chat-markdown min-w-0 break-words text-16 leading-8 [&_p]:text-16 [&_li]:text-16">
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

export function GuidedResearchReportDocument({ document, provisional = false, historical = false, idPrefix = "", title, actions, moreActions, onRegenerate, regenerateDisabled = false }: { document: ReportDocument; provisional?: boolean; historical?: boolean; idPrefix?: string; title?: string; limitations?: string; actions?: ReactNode; moreActions?: ReactNode; validationNotice?: ReactNode; onRegenerate?: () => void; regenerateDisabled?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  async function word() { if (!root.current) return; setExporting(true); setExportError(""); try { await downloadResearchWord(root.current, document.title); } catch { setExportError("导出失败，请重试。"); } finally { setExporting(false); } }
  const anchorId = (id: string) => `${idPrefix}${id}`;
  const anchors = [
    ...(document.summary ? [{ id: "research-report-summary", title: "执行摘要" }] : []),
    ...(document.introduction ? [{ id: "research-report-introduction", title: "研究范围与方法" }] : []),
    ...document.sections.map((section, index) => ({ id: `research-report-section-${index}`, title: `${index + 1}. ${section.title}` })),
    ...(document.conclusion ? [{ id: "research-report-conclusion", title: "综合结论" }] : []),
    ...(document.references.length ? [{ id: "research-report-references", title: "参考来源" }] : []),
  ];
  return <div className="space-y-6">{!historical && <><div className="flex flex-wrap items-center justify-between gap-3" data-testid="research-report-actions">{title && <h1 className="text-24 font-semibold">{title}</h1>}<div className="ml-auto flex items-center gap-2">{actions}<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="更多操作" data-testid="research-report-more-actions">更多操作</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{moreActions && <>{moreActions}<DropdownMenuSeparator /></>}{onRegenerate && <><DropdownMenuItem disabled={regenerateDisabled} onSelect={onRegenerate}>重新生成报告</DropdownMenuItem><DropdownMenuSeparator /></>}<DropdownMenuItem disabled={exporting} onSelect={() => void word()}>{exporting ? "正在导出…" : "下载 Word"}</DropdownMenuItem><DropdownMenuItem onSelect={() => { if (root.current) { try { printResearchPdf(root.current, document.title || "研究报告"); } catch { setExportError("无法打开打印窗口，请重试。"); } } }}>导出 PDF</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>{exportError && <p role="alert" className="text-12 text-destructive">{exportError}</p>}</>}{historical && <p className="text-12 text-muted-foreground">历史报告</p>}<article ref={root} className="mx-auto grid w-full min-w-0 gap-8 bg-card text-card-foreground xl:grid-cols-[12rem_minmax(0,1fr)] xl:gap-x-10" data-testid={anchorId(provisional ? "research-report-preview-text" : "research-report-document")}>
    <header className="border-b border-border pb-6 pt-3 xl:col-start-2"><h2 className="text-24 font-semibold leading-relaxed tracking-tight sm:text-30">{document.title || "研究报告"}</h2></header>
    {anchors.length > 0 && <nav aria-label="报告目录" className="min-w-0 border-b border-border pb-5 xl:sticky xl:top-6 xl:col-start-1 xl:row-start-2 xl:max-h-[calc(100vh-5rem)] xl:self-start xl:overflow-y-auto xl:border-b-0 xl:border-r xl:pr-5"><div className="flex items-center justify-between"><h3 className="text-14 font-semibold">目录</h3><button type="button" data-report-ui aria-expanded={contentsOpen} aria-controls={anchorId("research-report-contents")} onClick={() => setContentsOpen(!contentsOpen)} className="rounded-sm px-2 py-1 text-12 text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring xl:hidden">{contentsOpen ? "收起" : "展开"}</button></div><ol id={anchorId("research-report-contents")} className={`${contentsOpen ? "block" : "hidden"} mt-4 space-y-3 text-12 leading-relaxed xl:block`}>{anchors.map((anchor) => <li key={anchor.id}><a href={`#${anchorId(anchor.id)}`} className="block rounded-sm text-muted-foreground transition-colors hover:text-background-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{anchor.title}</a></li>)}</ol></nav>}
    <div className="min-w-0 space-y-10 xl:col-start-2 xl:row-start-2">
    {document.summary && <section id={anchorId("research-report-summary")} className="scroll-mt-6 space-y-3 border-l-2 border-primary pl-5"><h3 className="text-18 font-semibold">执行摘要</h3><ResearchReportMarkdown text={document.summary} references={document.references} /></section>}
    {document.introduction && <section id={anchorId("research-report-introduction")} className="scroll-mt-6 space-y-3" data-testid="research-report-introduction"><h3 className="text-20 font-semibold">研究范围与方法</h3><ResearchReportMarkdown text={document.introduction} references={document.references} /></section>}
    {document.sections.map((section, index) => <section id={anchorId(`research-report-section-${index}`)} key={`${section.sectionId}-${index}`} className="min-w-0 scroll-mt-6 space-y-4 border-t border-border pt-8" data-testid="research-report-chapter"><h3 className="text-20 font-semibold leading-relaxed">{index + 1}. {section.title}</h3><ResearchReportMarkdown text={chapterBody(section.body, section.title)} references={document.references} /></section>)}
    {document.conclusion && <section id={anchorId("research-report-conclusion")} className="scroll-mt-6 space-y-3 border-t border-border pt-8" data-testid="research-report-conclusion"><h3 className="text-20 font-semibold">综合结论</h3><ResearchReportMarkdown text={document.conclusion} references={document.references} /></section>}
    {document.references.length > 0 && <section id={anchorId("research-report-references")} className="scroll-mt-6 space-y-3 border-t border-border pt-8" aria-label="参考来源" data-testid="research-report-references"><h3 className="text-18 font-semibold">参考来源</h3><ol className="list-decimal space-y-3 pl-5 text-12 leading-relaxed">{document.references.map((reference) => <li key={reference.number} id={anchorId(`research-reference-${reference.number}`)}><a href={reference.url} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2 transition-colors hover:decoration-primary">{reference.title}</a><p className="mt-1 break-all text-muted-foreground">{reference.url}</p></li>)}</ol></section>}
    </div>
  </article></div>;
}
