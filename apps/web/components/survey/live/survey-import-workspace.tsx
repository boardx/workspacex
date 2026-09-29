"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { parseSurveyDesignMarkdown, serializeSurveyDesignMarkdown, serializeSurveyReportTemplateMarkdown } from "@repo/contracts/survey-source";
import { SurveyDraftInputSchema, SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
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
  if (!draft) return <main className="mx-auto max-w-4xl p-6"><p role="alert">导入信息无效，请返回问卷列表重新创建。</p><Button variant="outline" onClick={() => router.replace("/studio/survey")}>返回列表</Button></main>;
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
  return <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-28 font-semibold">导入内容</h1><p className="mt-1 text-13 text-muted-foreground">{draft.name} · AI 先生成 Markdown 提案，校对后才创建问卷。</p></div><Button variant="outline" onClick={() => router.replace(withProjectId("/studio/survey", projectId))}>← 返回列表</Button></header>
    <nav aria-label="问卷创建步骤" className="flex gap-4 text-13"><span aria-current="step" className="font-semibold">1 导入内容</span><span>2 设计问卷</span><span>3 发布与回收</span><span>4 查看答卷</span></nav>
    <SurveyAiProposal locked={false} storageKey={sessionKey} onApply={apply} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </main>;
}
