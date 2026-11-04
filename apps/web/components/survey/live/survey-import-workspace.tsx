"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { parseSurveyDesignMarkdown, serializeSurveyDesignMarkdown, serializeSurveyReportTemplateMarkdown } from "@repo/contracts/survey-source";
import { SurveyDraftInputSchema, SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withProjectId } from "@/components/project/project-breadcrumb";
import { linkProjectResource } from "@/lib/live-project-resources";
import type { SurveyCreationDraft } from "@/lib/survey/creation-draft";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { surveyPath } from "@/lib/survey/paths";
import { SurveyAiProposal } from "./ai-proposal";
import { useI18n } from "@/lib/i18n/provider";
import { displaySurveyMessage, surveyErrorMessage, type SurveyDisplayMessage } from "@/lib/survey/display-message";

const steps = [
  ["import", "survey.import.stepImport"],
  ["design", "survey.import.stepDesign"],
  ["publish", "survey.import.stepPublish"],
  ["responses", "survey.import.stepResponses"],
] as const;

export function SurveyImportWorkspace({ draft, projectId }: { draft: SurveyCreationDraft | null; projectId: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [error, setError] = React.useState<SurveyDisplayMessage | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const sessionKey = draft ? `survey:ai-import:${draft.name}:${draft.tags.join(",")}` : "";
  React.useEffect(() => {
    if (!sessionKey) return;
    setCreatedId(window.sessionStorage.getItem(`${sessionKey}:created-id`));
  }, [sessionKey]);
  if (!draft) return <main className="mx-auto max-w-4xl space-y-6 p-6"><Button variant="outline" onClick={() => router.replace("/studio/survey")}>{t("survey.import.backList")}</Button><p role="alert">{t("survey.import.invalidDraft")}</p></main>;
  async function apply(markdown: string) {
    if (!draft || busy) return;
    const parsed = parseSurveyDesignMarkdown(markdown);
    if (!parsed.ok) throw new Error("请先修正 Markdown 内容。");
    const input = SurveyDraftInputSchema.parse({
      ...parsed.draft,
      title: draft.name,
      tags: draft.tags,
      template: { id: crypto.randomUUID(), title: t("survey.create.reportTitle", { name: draft.name }), sections: [] },
    });
    const canonical = serializeSurveyDesignMarkdown(input);
    setBusy(true); setError(null);
    try {
      const created = createdId ? await surveyRequest(`/surveys/${createdId}`, {}, SurveyRuntimeSchema)
        : await surveyRequest("/surveys", { method: "POST", body: input }, SurveyRuntimeSchema);
      setCreatedId(created.id);
      window.sessionStorage.setItem(`${sessionKey}:created-id`, created.id);
      await surveyRequest(`/surveys/${created.id}/source`, { method: "PUT", body: {
        expectedVersion: created.version,
        documents: { design: canonical, publication: "# 发布设置\n", reportTemplate: serializeSurveyReportTemplateMarkdown(input.template) },
      } }, SurveyRuntimeSchema);
      if (projectId) await linkProjectResource({ projectId, kind: "survey", resourceId: created.id });
      window.sessionStorage.removeItem(sessionKey);
      window.sessionStorage.removeItem(`${sessionKey}:created-id`);
      router.replace(withProjectId(surveyPath(created.id, "design"), projectId));
    } catch (cause) {
      setError(surveyErrorMessage(cause, "survey.import.applyFailed"));
      throw cause;
    } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-4 p-4 pb-24 sm:p-5">
    <header className="space-y-3"><Button variant="ghost" className="-ml-3 text-muted-foreground" onClick={() => router.replace(withProjectId("/studio/survey", projectId))}><ArrowLeft className="mr-2 size-4" aria-hidden/>{t("survey.import.backSurveys")}</Button><div><h1 className="text-24 font-semibold">{t("survey.import.title")}</h1><p className="mt-1 text-14 text-muted-foreground">{draft.name}</p></div></header>
    <nav aria-label={t("survey.import.steps")} className="grid grid-cols-2 gap-2 text-13 sm:grid-cols-4 sm:gap-3">{steps.map(([id,label],index)=><span key={id} aria-current={index===0?"step":undefined} className={`flex items-center gap-2 ${index===0?'font-semibold':'text-muted-foreground'}`}><span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${index===0?'bg-primary text-primary-foreground':'border border-border'}`}>{index+1}</span>{t(label)}</span>)}</nav>
    <SurveyAiProposal locked={false} storageKey={sessionKey} onApply={apply} />
    {error && <p role="alert" className="text-destructive">{displaySurveyMessage(error, t, locale)}</p>}
  </main>;
}
