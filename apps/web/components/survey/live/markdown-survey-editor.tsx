"use client";

import { Button } from "@/components/ui/button";
import * as React from "react";
import { parseSurveyDesignMarkdown } from "@repo/contracts/survey-source";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/** Markdown is the editable source; preview is applied only after validation. */
export function MarkdownSurveyEditor({ value, locked, onChange, onPreview }: {
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
  onPreview: () => void;
}) {
  const [reviewing, setReviewing] = React.useState(false);
  const parsed = React.useMemo(() => parseSurveyDesignMarkdown(value), [value]);
  return (
    <details className="mx-auto max-w-6xl rounded-lg border border-border bg-card p-5" open>
      <summary className="cursor-pointer text-16 font-semibold">Markdown 问卷内容</summary>
      <section className="mt-4 space-y-3" aria-label="Markdown 问卷源文档">
        <p className="text-12 text-muted-foreground">
          {locked ? "已发布题目已冻结，保留历史答卷对应的版本。" : "编辑 Markdown，校对题目预览后保存。模板和手工编辑也使用同一份源文档。"}
        </p>
        <textarea aria-label="问卷 Markdown" className="min-h-64 w-full rounded-md border border-border bg-background p-4 font-mono text-13" value={value} readOnly={locked} onChange={(event) => onChange(event.target.value)} />
        <Button variant="outline" onClick={() => setReviewing(true)}>校对并预览题目</Button>
        <Dialog open={reviewing} onOpenChange={setReviewing}>
          <DialogContent className="max-h-[85vh] max-w-5xl overflow-auto">
            <DialogTitle>Markdown 预览与校对</DialogTitle>
            <DialogDescription>确认内容后应用到设计区；应用不会自动保存或发布。</DialogDescription>
            <div className="grid gap-5 md:grid-cols-2">
              <textarea aria-label="校对 Markdown" readOnly={locked} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-80 rounded-md border border-border p-4 font-mono text-13" />
              <section aria-label="问卷渲染预览" className="space-y-4 rounded-md border border-border p-4">
                {parsed.ok ? <>
                  <h2 className="text-18 font-semibold">{parsed.draft.title}</h2>
                  <p className="text-12 text-muted-foreground">共 {parsed.draft.questions.length} 道题</p>
                  {parsed.draft.questions.map((question, index) => <article key={question.id} className="space-y-2 border-t border-border pt-3">
                    <h3>{index + 1}. {question.title}{question.required ? " *" : ""}</h3>
                    {question.options?.map((option, i) => <p key={i} className="text-13 text-muted-foreground">○ {option}</p>)}
                  </article>)}
                </> : <div role="alert">{parsed.diagnostics.map((entry, index) => <p key={index}>第 {entry.line} 行：{entry.message}</p>)}</div>}
              </section>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReviewing(false)}>继续编辑</Button>
              <Button disabled={!parsed.ok || locked} onClick={() => { onPreview(); setReviewing(false); }}>应用到问卷</Button>
            </div>
          </DialogContent>
        </Dialog>
      </section>
    </details>
  );
}
