"use client";

import * as React from "react";
import Image from "next/image";
import { Database, Eye, FileText, FileDown, BookOpen, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadResearchWord, printResearchPdf } from "@/lib/research-report-export";
import type { ReportDocument } from "@/lib/research-report-document";
import { chapterBody, ResearchReportMarkdown } from "./guided-research-report-document";

export function ResearchPrototypeReport({ document, sources, limitations, actions, moreActions, onRegenerate, disabled }: { document: ReportDocument; sources: number; limitations?: string; actions?: React.ReactNode; moreActions?: React.ReactNode; onRegenerate: () => void; disabled: boolean }) {
  const root = React.useRef<HTMLElement>(null);
  const [exporting, setExporting] = React.useState(false);
  const [error, setError] = React.useState("");
  const words = [document.summary, document.introduction ?? "", ...document.sections.map((section) => section.body), document.conclusion ?? ""].join("").length;
  async function word() { if (!root.current) return; setError(""); setExporting(true); try { await downloadResearchWord(root.current, document.title); } catch { setError("导出失败，请重试。"); } finally { setExporting(false); } }
  function pdf() { if (!root.current) return; setError(""); try { printResearchPdf(root.current, document.title); } catch { setError("无法打开打印窗口，请重试。"); } }
  const metrics = [{ icon: Database, count: sources, title: "核心数据来源", detail: "已保留的真实资料" }, { icon: BookOpen, count: document.sections.length, title: "研究章节", detail: "按已确认的研究计划生成" }, { icon: Link, count: document.references.length, title: "引用来源", detail: "正文中可追溯的证据" }, { icon: FileText, count: words.toLocaleString(), title: "报告字数", detail: "当前报告正文字符数" }];
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-end gap-3" data-testid="research-report-actions"><Button variant="outline" className="h-12 px-5 text-lg" onClick={() => root.current?.querySelector("#research-report-summary")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Eye className="mr-2 size-5" />在线查看</Button><Button variant="outline" className="h-12 px-5 text-lg" disabled={exporting} onClick={() => void word()}><FileText className="mr-2 size-5" />{exporting ? "正在导出…" : "下载 Word"}</Button><Button variant="outline" className="h-12 px-5 text-lg" onClick={pdf}><FileDown className="mr-2 size-5" />导出 PDF</Button>{actions}<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="h-12 px-4 text-base" aria-label="更多操作" data-testid="research-report-more-actions">更多操作</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{moreActions}{moreActions && <DropdownMenuSeparator />}<DropdownMenuItem disabled={disabled} onSelect={onRegenerate}>重新生成报告</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <article ref={root} className="space-y-7" data-testid="research-report-document">
      <header className="grid items-start gap-6 border-b pb-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="overflow-hidden rounded bg-muted shadow-md" data-testid="research-report-cover"><div className="min-h-32 px-5 pt-5"><p className="text-lg font-bold leading-relaxed">{document.title}</p><p className="mt-4 text-xs text-muted-foreground">Deep Research · 研究报告</p></div><div className="relative mt-4 h-28"><Image src="/research/energy-storage-cover.png" alt="" fill sizes="210px" className="object-cover object-center grayscale" /></div><p className="px-5 py-2 text-xs font-medium">Deep Research</p></div>
        <div className="min-w-0"><h2 className="text-3xl font-bold leading-relaxed">{document.title || "研究报告"}</h2><p className="mt-3 text-base text-muted-foreground">研究章节：{document.sections.length} 章　｜　报告字数：约 {words.toLocaleString()} 字</p><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ icon: Icon, count, title, detail }) => <div key={title} className="rounded-lg border p-4"><Icon className="size-7" /><p className="mt-3 text-3xl font-bold">{count}</p><p className="mt-1 text-base font-semibold">{title}</p><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p></div>)}</div></div>
      </header>
      {document.summary && <section id="research-report-summary" className="grid scroll-mt-80 gap-5 sm:grid-cols-[8rem_minmax(0,1fr)]"><h3 className="text-3xl font-bold">执行摘要</h3><ResearchReportMarkdown text={document.summary} references={document.references} /></section>}
      {document.introduction && <section id="research-report-introduction" className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-introduction"><h3 className="text-2xl font-bold">研究范围与方法</h3><ResearchReportMarkdown text={document.introduction} references={document.references} /></section>}
      {document.sections.map((section, index) => <section key={section.sectionId} id={`research-report-section-${index}`} className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-chapter"><h3 className="text-2xl font-bold">{index + 1}. {section.title}</h3><ResearchReportMarkdown text={chapterBody(section.body, section.title)} references={document.references} /></section>)}
      {document.conclusion && <section id="research-report-conclusion" className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-conclusion"><h3 className="text-2xl font-bold">综合结论</h3><ResearchReportMarkdown text={document.conclusion} references={document.references} /></section>}
      {!!document.references.length && <section id="research-report-references" className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-references"><h3 className="text-2xl font-bold">参考来源</h3><ol className="list-inside list-decimal space-y-3 text-base">{document.references.map((reference) => <li key={reference.number}><a className="underline underline-offset-4" href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a></li>)}</ol></section>}
      {limitations && <p className="rounded-lg border border-destructive/40 p-4 text-base" data-testid="research-report-limitations">{limitations}</p>}
    </article>
  </div>;
}
