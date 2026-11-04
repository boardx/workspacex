"use client";

import { Button } from "@/components/ui/button";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { displaySurveyMessage, type SurveyDisplayMessage } from "@/lib/survey/display-message";
import { displaySurveyDiagnostic } from "@/lib/survey/display-diagnostic";
import { parseSurveyDesignMarkdown } from "@repo/contracts/survey-source";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/** Markdown is the editable source; preview is applied only after validation. */
export function MarkdownSurveyEditor({ value, locked, onChange, onPreview }: {
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
  onPreview: () => void;
}) {
  const { t, locale } = useI18n();
  const [reviewing, setReviewing] = React.useState(false);
  const [fileError, setFileError] = React.useState<SurveyDisplayMessage | null>(null);
  const fileRead = React.useRef(0);
  const parsed = React.useMemo(() => parseSurveyDesignMarkdown(value), [value]);
  return (
    <details className="mx-auto max-w-6xl rounded-lg border border-border bg-card p-5" open>
      <summary className="cursor-pointer text-16 font-semibold">{t("survey.design.markdownContent")}</summary>
      <section className="mt-4 space-y-3" aria-label={t("survey.design.markdownSource")}>
        <p className="text-12 text-muted-foreground">
          {locked ? t("survey.design.markdownLocked") : t("survey.design.markdownHint")}
        </p>
        <textarea aria-label={t("survey.design.markdown")} className="min-h-64 w-full rounded-md border border-border bg-background p-4 font-mono text-13" value={value} readOnly={locked} onChange={(event) => onChange(event.target.value)} />
        {!locked && <label className="block text-13">
          {t("survey.design.uploadMarkdown")}
          <input type="file" accept=".md,.markdown,text/markdown" className="mt-2 block max-w-full text-12" onChange={(event) => {
            const file = event.target.files?.[0];
            const readId = ++fileRead.current;
            event.target.value = "";
            setFileError(null);
            if (!file) return;
            if (!/\.(md|markdown)$/i.test(file.name) || file.size > 262144) {
              setFileError({ key: "survey.design.markdownFileInvalid" }); return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              if (readId !== fileRead.current) return;
              onChange(String(reader.result ?? "").replace(/^\uFEFF/, ""));
            };
            reader.onerror = () => { if (readId === fileRead.current) setFileError({ key: "survey.design.markdownFileFailed" }); };
            reader.readAsText(file, "UTF-8");
          }} />
        </label>}
        {fileError && <p role="alert" className="text-12 text-destructive">{displaySurveyMessage(fileError, t, locale)}</p>}
        <Button variant="outline" onClick={() => setReviewing(true)}>{t("survey.design.reviewQuestions")}</Button>
        <Dialog open={reviewing} onOpenChange={setReviewing}>
          <DialogContent className="max-h-[85vh] max-w-5xl overflow-auto">
            <DialogTitle>{t("survey.design.markdownReview")}</DialogTitle>
            <DialogDescription>{t("survey.design.markdownReviewHint")}</DialogDescription>
            <div className="grid gap-5 md:grid-cols-2">
              <textarea aria-label={t("survey.design.reviewMarkdown")} readOnly={locked} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-80 rounded-md border border-border p-4 font-mono text-13" />
              <section aria-label={t("survey.design.renderedPreview")} className="space-y-4 rounded-md border border-border p-4">
                {parsed.ok ? <>
                  <h2 className="text-18 font-semibold">{parsed.draft.title}</h2>
                  <p className="text-12 text-muted-foreground">{t("survey.design.markdownCount", { count: parsed.draft.questions.length })}</p>
                  {parsed.draft.questions.map((question, index) => <article key={question.id} className="space-y-2 border-t border-border pt-3">
                    <h3>{index + 1}. {question.title}{question.required ? " *" : ""}</h3>
                    {question.options?.map((option, i) => <p key={i} className="text-13 text-muted-foreground">○ {option}</p>)}
                  </article>)}
                </> : <div role="alert">{parsed.diagnostics.map((entry, index) => <p key={index}>{t("survey.design.diagnosticLine", { line: entry.line, message: displaySurveyDiagnostic(entry.message, t) })}</p>)}</div>}
              </section>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReviewing(false)}>{t("survey.design.continueEditing")}</Button>
              <Button disabled={!parsed.ok || locked} onClick={() => { onPreview(); setReviewing(false); }}>{t("survey.design.applySurvey")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </section>
    </details>
  );
}
