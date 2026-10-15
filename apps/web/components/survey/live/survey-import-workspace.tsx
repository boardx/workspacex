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

export function SurveyImportWorkspace({ draft, projectId }: { draft: SurveyCreationDraft | null; projectId: string | null }) {
  const router = useRouter();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const sessionKey = draft ? `survey:ai-import:${draft.name}:${draft.tags.join(",")}` : "";
  React.useEffect(() => {
    if (!sessionKey) return;
    setCreatedId(window.sessionStorage.getItem(`${sessionKey}:created-id`));
  }, [sessionKey]);
  if (!draft) return <main className="mx-auto max-w-4xl space-y-6 p-6"><Button variant="outline" onClick={() => router.replace("/studio/survey")}>返回列表</Button><p role="alert">导入信息无效，请返回问卷列表重新创建。</p></main>;
  async function apply(markdown: string) {
    if (!draft || busy) return;
    const parsed = parseSurveyDesignMarkdown(markdown);
    if (!parsed.ok) throw new Error("请先修正 Markdown 内容。");
    const input = SurveyDraftInputSchema.parse({
      ...parsed.draft,
      title: draft.name,
      tags: draft.tags,
      template: { id: crypto.randomUUID(), title: `${draft.name}分析报告`, sections: [] },
    });
    const canonical = serializeSurveyDesignMarkdown(input);
    setBusy(true); setError("");
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
      const message = cause instanceof Error ? cause.message : "应用失败，请重试。";
      setError(message);
      throw cause;
    } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-4 p-4 pb-24 sm:p-5">
    <header className="space-y-3"><Button variant="ghost" className="-ml-3 text-muted-foreground" onClick={() => router.replace(withProjectId("/studio/survey", projectId))}><ArrowLeft className="mr-2 size-4" aria-hidden/>返回问卷</Button><div><h1 className="text-24 font-semibold">创建问卷</h1><p className="mt-1 text-14 text-muted-foreground">{draft.name}</p></div></header>
    <nav aria-label="问卷创建步骤" className="grid grid-cols-2 gap-2 text-13 sm:grid-cols-4 sm:gap-3">{["导入内容","设计问卷","发布与回收","查看答卷"].map((label,index)=><span key={label} aria-current={index===0?"step":undefined} className={`flex items-center gap-2 ${index===0?'font-semibold':'text-muted-foreground'}`}><span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${index===0?'bg-primary text-primary-foreground':'border border-border'}`}>{index+1}</span>{label}</span>)}</nav>
    <SurveyAiProposal locked={false} storageKey={sessionKey} onApply={apply} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </main>;
}
