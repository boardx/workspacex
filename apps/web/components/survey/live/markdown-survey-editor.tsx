"use client";

import { Button } from "@/components/ui/button";

/** Markdown is the editable source; preview is applied only after validation. */
export function MarkdownSurveyEditor({ value, locked, onChange, onPreview }: {
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
  onPreview: () => void;
}) {
  return (
    <details className="mx-auto max-w-6xl rounded-lg border border-border bg-card p-5" open>
      <summary className="cursor-pointer text-16 font-semibold">Markdown 问卷内容</summary>
      <section className="mt-4 space-y-3" aria-label="Markdown 问卷源文档">
        <p className="text-12 text-muted-foreground">
          {locked ? "已发布题目已冻结，保留历史答卷对应的版本。" : "编辑 Markdown，校对题目预览后保存。模板和手工编辑也使用同一份源文档。"}
        </p>
        <textarea aria-label="问卷 Markdown" className="min-h-64 w-full rounded-md border border-border bg-background p-4 font-mono text-13" value={value} readOnly={locked} onChange={(event) => onChange(event.target.value)} />
        <Button variant="outline" onClick={onPreview}>校对并预览题目</Button>
      </section>
    </details>
  );
}
