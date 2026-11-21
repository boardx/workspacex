"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtIdeaSheet } from "../lib/aidt-idea-sheets";

export function AidtIdeaSheetPreview({ sheets, printing, onPrint }: { sheets: readonly AidtIdeaSheet[]; printing: boolean; onPrint: (id?: string) => void }) {
  return <section aria-label="点子描述单预览" className="space-y-4 rounded-lg border border-border p-4" data-testid="aidt-idea-sheets-preview">
    <h4 className="text-16 font-semibold">逐份审阅描述单</h4>
    <p className="text-12 text-muted-foreground">以下图文就是本次打印内容。可逐份另存为 PDF；打开打印不代表文件已经保存，也不代替上方小组保存。</p>
    {sheets.map((sheet, index) => <article key={sheet.id} className="space-y-3 border-t border-border pt-4" data-testid="aidt-idea-sheet" data-idea-id={sheet.id}>
      <h5 className="break-words text-16 font-semibold">{index + 1}. {sheet.title}{sheet.proposed ? "（拟选择，非投票）" : ""}</h5>
      {/* eslint-disable-next-line @next/next/no-img-element -- only a validated native blob or a clearly labelled local preview */}
      <img src={sheet.imageSrc} alt={`${sheet.title}描述单图像`} className="max-h-64 w-full rounded-md object-contain" />
      <p className="whitespace-pre-wrap break-words text-13">{sheet.description}</p>
      {sheet.hmw && <p className="text-12">{sheet.hmw}</p>}
      <p className="text-12">{sheet.categories}</p><p className="text-12">{sheet.categoryReason}</p>
      <details className="text-12 text-muted-foreground"><summary className="cursor-pointer">来源与版本</summary><p className="mt-1 break-all">{sheet.source}</p></details>
      <Button type="button" size="sm" variant="outline" disabled={printing} data-testid={`aidt-idea-sheet-print-${index + 1}`} onClick={() => onPrint(sheet.id)}>打印候选 {index + 1} 描述单 PDF</Button>
    </article>)}
    <Button type="button" size="sm" variant="outline" disabled={printing} onClick={() => onPrint()}>合并打印描述单 PDF</Button>
  </section>;
}
