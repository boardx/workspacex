"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AidtSharedStage } from "../lib/live-aidt-stages";

export function AidtReportDirectory({ stage, href }: { stage?: AidtSharedStage; href: (entityId: string) => string }) {
  const reports = stage?.content.reports ?? {};
  const entries = [
    { id: "group-report", title: "小组研究报告", report: stage?.content.summaryReport },
    ...Object.entries(reports).filter(([id]) => id !== "group-report").map(([id, report]) => ({
      id, report, title: /^#{1,6}\s+(.+)/.exec(report.markdown.trim())?.[1]?.slice(0, 80) || "小组报告",
    })),
  ];
  return <ul aria-label="报告卡片" className="grid gap-3 sm:grid-cols-2">
    {entries.map(({ id, title, report }) => <li key={id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <FileText aria-hidden className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 space-y-1">
          <h2 className="break-words text-14 font-semibold">{title}</h2>
          <p className="text-12 text-muted-foreground">{report?.confirmedAtRevision ? `已确认 · V${report.confirmedAtRevision}` : report ? "待确认" : "待起草"}</p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="mt-auto self-start"><Link href={href(id)}>{id === "group-report" ? "打开小组研究报告" : `打开「${title}」`}</Link></Button>
    </li>)}
  </ul>;
}
