"use client";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import Image from "next/image";
import { Database, Eye, FileText, BookOpen, Link } from "lucide-react";
import { WorkflowActionButton, WorkflowActionBar } from "./research-workflow-actions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { research as C } from "@repo/contracts";
import type { ReportDocument } from "@/lib/research-report-document";
import { chapterBody, ResearchReportMarkdown } from "./guided-research-report-document";

export function ResearchPrototypeReport({ document, sources, limitations, actions, fileActions, moreActions, onRegenerate, disabled }: { document: ReportDocument; sources: number; limitations?: string; actions?: React.ReactNode; fileActions?: React.ReactNode; moreActions?: React.ReactNode; onRegenerate: () => void; disabled: boolean }) {
  const { t, locale } = useI18n();
  const root = React.useRef<HTMLElement>(null);
  const headings = document.headings ?? C.guidedResearchReportFraming({ topic: document.title, goal: document.summary, focus: document.introduction ?? "" }).headings;
  const words = [document.summary, document.introduction ?? "", ...document.sections.map((section) => section.body), document.conclusion ?? ""].join("").length;
  const metrics = [{ icon: Database, count: sources, title: t("research.report.coreSources"), detail: t("research.report.sourcesDetail") }, { icon: BookOpen, count: document.sections.length, title: t("research.report.chapters"), detail: t("research.report.chaptersDetail") }, { icon: Link, count: document.references.length, title: t("research.report.citations"), detail: t("research.report.citationsDetail") }, { icon: FileText, count: words.toLocaleString(locale), title: t("research.report.characters"), detail: t("research.report.charactersDetail") }];
  return <div className="space-y-5">
    <article ref={root} className="min-w-0 space-y-7 break-words" data-testid="research-report-document">
      <header className="grid items-start gap-6 border-b pb-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="overflow-hidden rounded bg-muted shadow-md" data-testid="research-report-cover"><div className="min-h-32 px-5 pt-5"><p className="text-base font-bold leading-relaxed">{document.title}</p><p className="mt-4 text-xs text-muted-foreground">Deep Research · {t("research.node.report")}</p></div><div className="relative mt-4 h-28"><Image src="/research/energy-storage-cover.png" alt="" fill sizes="210px" className="object-cover object-center grayscale" /></div><p className="px-5 py-2 text-xs font-medium">Deep Research</p></div>
        <div className="min-w-0"><h2 className="text-2xl font-bold leading-relaxed">{document.title || t("research.node.report")}</h2><p className="mt-3 text-base text-muted-foreground">{t("research.report.metrics", { chapters: document.sections.length, characters: words.toLocaleString(locale) })}</p><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ icon: Icon, count, title, detail }) => <div key={title} className="rounded-lg border p-4"><Icon className="size-7" /><p className="mt-3 text-2xl font-bold">{count}</p><p className="mt-1 text-base font-semibold">{title}</p><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p></div>)}</div></div>
      </header>
      {document.summary && <section id="research-report-summary" className="grid scroll-mt-80 gap-5 sm:grid-cols-[8rem_minmax(0,1fr)]"><h3 className="text-2xl font-bold">{headings.summary}</h3><ResearchReportMarkdown text={document.summary} references={document.references} /></section>}
      {document.introduction && <section id="research-report-introduction" className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-introduction"><h3 className="text-2xl font-bold">{headings.introduction}</h3><ResearchReportMarkdown text={document.introduction} references={document.references} /></section>}
      {document.sections.map((section, index) => <section key={section.sectionId} id={`research-report-section-${index}`} className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-chapter"><h3 className="text-2xl font-bold">{index + 1}. {section.title}</h3><ResearchReportMarkdown text={chapterBody(section.body, section.title)} references={document.references} headingPrefix={`research-report-section-${index}`} /></section>)}
      {document.conclusion && <section id="research-report-conclusion" className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-conclusion"><h3 className="text-2xl font-bold">{headings.conclusion}</h3><ResearchReportMarkdown text={document.conclusion} references={document.references} /></section>}
      {!!document.references.length && <section id="research-report-references" className="scroll-mt-80 space-y-4 border-t pt-7" data-testid="research-report-references"><h3 className="text-2xl font-bold">{headings.references}</h3><ol className="list-inside list-decimal space-y-3 text-base">{document.references.map((reference) => <li key={reference.number}><a className="underline underline-offset-4" href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a></li>)}</ol></section>}
      {limitations && <p className="rounded-lg border border-destructive/40 p-4 text-base" data-testid="research-report-limitations">{limitations}</p>}
    </article>
    <WorkflowActionBar placement="footer" data-testid="research-report-actions"><DropdownMenu><DropdownMenuTrigger asChild><WorkflowActionButton variant="outline" aria-label={t("research.report.more")} data-testid="research-report-more-actions">{t("research.report.more")}</WorkflowActionButton></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => root.current?.querySelector("#research-report-summary")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Eye className="mr-2 size-4" />{t("research.report.online")}</DropdownMenuItem>{moreActions}{moreActions && <DropdownMenuSeparator />}<DropdownMenuItem disabled={disabled} onSelect={onRegenerate}>{t("research.report.regenerate")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>{fileActions}<span className="contents [&_[role=status]]:hidden sm:[&_[role=status]]:inline">{actions}</span></WorkflowActionBar>
  </div>;
}
