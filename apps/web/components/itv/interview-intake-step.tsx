"use client";
import { INTERVIEW_INTAKE_ERROR_TEXT } from "@/lib/interview-intake-error-text";
import type { MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { ArrowRight, FileText, Mic } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import { InterviewVoiceInput } from "./interview-voice-input";
import { InterviewStepHeader, InterviewStepActions } from "./interview-step-header";

const intakeErrorKeys: Record<string, MessageKey> = {
  [INTERVIEW_INTAKE_ERROR_TEXT.UTF8_ONLY]: "itv.intake.reason.UTF8_ONLY",
  [INTERVIEW_INTAKE_ERROR_TEXT.TOO_LARGE_TEXT]: "itv.intake.reason.TOO_LARGE_TEXT",
  [INTERVIEW_INTAKE_ERROR_TEXT.INVALID_UTF8]: "itv.intake.reason.INVALID_UTF8",
  [INTERVIEW_INTAKE_ERROR_TEXT.EMPTY_FILE]: "itv.intake.reason.EMPTY_FILE",
  [INTERVIEW_INTAKE_ERROR_TEXT.IMMUTABLE]: "itv.intake.reason.IMMUTABLE",
  [INTERVIEW_INTAKE_ERROR_TEXT.TOO_LARGE_SYNC]: "itv.intake.reason.TOO_LARGE_SYNC",
};

/** Controlled Markdown editor. Content changes are not implicit confirmation. */
export function InterviewIntakeStep({ markdown, onChange, onConfirm, pending, onImportFile, onUploadFile, onVoice, readOnly = false, voiceSessionToken, onVoiceBusyChange }: {
  readonly markdown: string;
  readonly onChange: (markdown: string) => void;
  readonly onConfirm: () => Promise<void>;
  readonly pending: boolean;
  readonly onImportFile?: (file: File) => Promise<string>;
  readonly onUploadFile?: (file: File) => Promise<void>;
  readonly onVoice?: () => Promise<string>;
  readonly readOnly?: boolean;
  readonly voiceSessionToken?: string;
  readonly onVoiceBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = React.useState<{ detail: string } | null>(null);
  const [working, setWorking] = React.useState(false);
  const [voiceBusy, setVoiceBusy] = React.useState(false);
  const [voicePreview, setVoicePreview] = React.useState("");
  const fileInput = React.useRef<HTMLInputElement>(null);
  const busy = pending || working || voiceBusy;
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setWorking(true); setError(null);
    try { await action(); }
    catch (cause) { setError({ detail: cause instanceof Error ? cause.message : "" }); }
    finally { setWorking(false); }
  }
  function append(text: string) {
    if (!text.trim()) throw new Error("EMPTY_IMPORTED_TEXT");
    onChange(markdown ? `${markdown}\n\n${text}` : text);
  }
  return <div data-testid="itv-markdown-intake" className="flex flex-1 flex-col">
    <InterviewStepHeader title={t("itv.intake.title")} />
    <section className="flex flex-1 flex-col gap-3">
      <label htmlFor="interview-demand-markdown" className="text-sm font-medium">{t("itv.intake.label")}</label>
      <p id="interview-demand-hint" className="text-sm text-muted-foreground">{t("itv.intake.hint")}</p>
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-input bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <Textarea aria-label={t("itv.intake.aria")} id="interview-demand-markdown" aria-describedby="interview-demand-hint" value={voicePreview ? (markdown ? `${markdown}\n\n${voicePreview}` : voicePreview) : markdown} onChange={(event) => onChange(event.target.value)} disabled={busy} readOnly={readOnly}
          placeholder={t("itv.intake.placeholder")}
          className="min-h-48 flex-1 rounded-none border-0 bg-transparent px-5 py-4 text-sm leading-7 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap gap-3">
      {voiceSessionToken ? <InterviewVoiceInput sessionToken={voiceSessionToken} disabled={pending || working} readOnly={readOnly} onAppend={append} onPreview={setVoicePreview} onBusyChange={(active) => { setVoiceBusy(active); onVoiceBusyChange?.(active); }} /> : <Button variant="outline" disabled={busy || readOnly || !onVoice} onClick={() => void perform(async () => append(await onVoice!()))}><Mic className="size-4" aria-hidden />{t("itv.intake.voice")}</Button>}
      <Button variant="outline" disabled={busy || readOnly || !(onImportFile || onUploadFile)} onClick={() => fileInput.current?.click()}><FileText className="size-4" aria-hidden />{onUploadFile ? t("itv.intake.upload") : t("itv.intake.importText")}</Button>

            <input ref={fileInput} type="file" accept={onUploadFile ? ".txt,.md,.markdown,.pdf,.docx,.pptx,.xlsx,.csv" : ".txt,.md,.markdown,text/plain,text/markdown"} aria-label={t("itv.intake.importFile")} className="sr-only" disabled={busy || readOnly || !(onImportFile || onUploadFile)}
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file && !readOnly) void perform(async () => { if (onUploadFile) await onUploadFile(file); else if (onImportFile) append(await onImportFile(file)); }); }} />
          </div>
          <span className="text-xs text-muted-foreground">{t("itv.characters", { count: markdown.length })}</span>
        </div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm leading-6 text-destructive">{t("itv.intake.failure", { detail: Object.hasOwn(intakeErrorKeys, error.detail) ? t(intakeErrorKeys[error.detail]!) : error.detail === "EMPTY_IMPORTED_TEXT" ? t("itv.intake.empty") : error.detail || t("itv.operationFailed") })}</p>}
    </section>
    <InterviewStepActions><ActionButton variant="primary" loading={busy} icon={<ArrowRight className="size-4" aria-hidden />} disabled={busy || !markdown.trim()} onClick={() => void perform(onConfirm)}>{busy ? t("itv.processing") : t("itv.intake.next")}</ActionButton></InterviewStepActions>
  </div>;
}
