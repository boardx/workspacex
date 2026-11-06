"use client";
import { displaySurveyRuntimeError } from "@/lib/survey/display-runtime-error";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { SurveyCreateCommandSchema, SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { linkProjectResource } from "@/lib/live-project-resources";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { surveyRequest } from "@/lib/survey/runtime-client";
export function SurveyDraftCopy({ runtime, onCreated, disabled, projectId }: { projectId?: string | null; runtime: SurveyRuntime; onCreated: (id: string) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | Error>("");
  const lock = React.useRef(false);
  const createdId = React.useRef<string | null>(null);
  async function copy() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const suffix = t("survey.workspace.newDraftSuffix");
      const titleLimit = SurveyCreateCommandSchema.shape.draft.shape.title.maxLength ?? Number.POSITIVE_INFINITY;
      const prefixLength = locale === "zh-CN" ? 194 : Math.max(0, titleLimit - suffix.length);
      const command = SurveyCreateCommandSchema.parse({ anonymity: runtime.anonymity, draft: {
        title: `${runtime.title.slice(0, prefixLength)}${suffix}`, tags: runtime.tags,
        questions: structuredClone(runtime.publication?.questions ?? runtime.questions),
        template: structuredClone(runtime.template),
      } });
      const id = createdId.current ?? (await surveyRequest("/surveys", { method: "POST", body: command }, SurveyRuntimeSchema)).id;
      createdId.current = id;
      if (projectId) await linkProjectResource({ projectId, kind: "survey", resourceId: id });
      setOpen(false); onCreated(id);
    } catch (failure) { setError(failure instanceof Error ? failure : surveyRuntimeMessages.create); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!lock.current) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled}>{t("survey.workspace.copyDraft")}</Button></DialogTrigger>
    <DialogContent>
      <DialogTitle>{t("survey.workspace.copyTitle")}</DialogTitle>
      <DialogDescription>{t("survey.workspace.copyHelp")}</DialogDescription>
      {error && <p role="alert" className="text-13 text-destructive">{displaySurveyRuntimeError(error, t, locale)}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t("survey.workspace.cancel")}</Button><Button type="button" disabled={busy} onClick={() => void copy()}>{busy ? t("survey.workspace.creating") : t("survey.workspace.confirmCopy")}</Button></div>
    </DialogContent>
  </Dialog>;
}
