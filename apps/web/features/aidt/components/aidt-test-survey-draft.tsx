"use client";
import * as React from "react";
import Link from "next/link";
import { SurveyAiProposal } from "@/components/survey/live/ai-proposal";
import { parseSurveyDesignMarkdown, serializeSurveyDesignMarkdown, serializeSurveyReportTemplateMarkdown } from "@repo/contracts/survey-source";
import { SurveyDraftInputSchema, SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { linkProjectResource } from "@/lib/live-project-resources";
import { useOptionalSession } from "@/components/session/session-provider";
import { readAidtStage } from "../lib/live-aidt-stages";
import { loadAidtTestResearchContext } from "../lib/aidt-test-prototype-context";
import { readAidtTestGroups, type AidtTestGroup } from "../lib/aidt-test-groups";

/** Compose the existing Survey authoring flow; never publish or submit answers. */
export function AidtTestSurveyDraft({ projectId, group, readOnly, onCreated }: { projectId: string; group: AidtTestGroup; readOnly: boolean; onCreated: (id: string) => void }) {
  const session = useOptionalSession()?.session;
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const [prototypeContext, setPrototypeContext] = React.useState<{ scope: string; text: string } | null>(null);
  const created = React.useRef<string | null>(null), unknownCreation = React.useRef(false);
  const scope = JSON.stringify([projectId, session?.currentOrgId, session?.userId, session?.sessionToken, group.id, group.designId, group.versionId, group.stage5Revision, group.prototypeEntity, group.task, group.situation, readOnly]);
  const current = React.useRef(scope); current.current = scope;
  React.useEffect(() => { current.current = scope; return () => { if (current.current === scope) current.current = ""; }; }, [scope]);
  const frozenGroup = React.useMemo(() => ({ stage5Revision: group.stage5Revision, designId: group.designId, versionId: group.versionId, prototypeEntity: group.prototypeEntity }), [group.stage5Revision, group.designId, group.versionId, group.prototypeEntity]);
  React.useEffect(() => {
    if (!expanded || !session?.sessionToken || !session.userId) return;
    const controller = new AbortController(); setPrototypeContext(null);
    void loadAidtTestResearchContext({ projectId, sessionToken: session.sessionToken, userId: session.userId, signal: controller.signal }, frozenGroup).then(context => {
      if (!controller.signal.aborted) setPrototypeContext({ scope, text: context.text });
    }).catch(() => { if (!controller.signal.aborted) setError("无法读取所选原型版本，未准备问卷生成上下文。原引用保留。"); });
    return () => controller.abort();
  }, [expanded, projectId, frozenGroup, scope, session?.sessionToken, session?.userId]);
  const brief = [`请围绕下面的固定原型与测试问题生成可编辑问卷草稿。`, `第5步保存版本：V${group.stage5Revision}`, `Design：${group.designId}；原型精确版本：${group.versionId}`, `研究问题与任务：${group.task}`, `使用情境：${group.situation || "待学生补充"}`, prototypeContext?.scope === scope ? prototypeContext.text : "原型内容尚未读取，不得猜测", `请询问对原型的理解、使用障碍与需求，不诱导赞同。静态原型的问卷意向不能证明真实付款或时间投入。问卷先由学生编辑与确认，发布和分享另由操作者在原生问卷界面明确执行。`].join("\n");
  async function apply(markdown: string) {
    if (busy || readOnly || !session?.sessionToken) return;
    if (unknownCreation.current) throw new Error("创建结果尚不确定，请先到原生问卷列表核对并关联，不能重复创建。");
    const parsed = parseSurveyDesignMarkdown(markdown);
    if (!parsed.ok) throw new Error("请先修正问卷 Markdown。");
    const input = SurveyDraftInputSchema.parse({ ...parsed.draft, title: (group.name || parsed.draft.title || "原型测试调查").slice(0, 200), tags: ["AIDT"], template: { id: crypto.randomUUID(), title: "原型测试调查报告", sections: [] } });
    const expected = scope; setBusy(true); setError("");
    try {
      const { stage } = await readAidtStage(projectId, 6, session.sessionToken);
      const saved = stage && readAidtTestGroups(stage.content.draft.fields).find(item => item.id === group.id && !item.archived);
      if (!saved || saved.method !== "survey" || saved.source || saved.designId !== group.designId || saved.versionId !== group.versionId || saved.stage5Revision !== group.stage5Revision || saved.task !== group.task || saved.situation !== group.situation || current.current !== expected) throw new Error("SOURCE_CHANGED");
      let survey;
      if (created.current) survey = await surveyRequest(`/surveys/${encodeURIComponent(created.current)}`, {}, SurveyRuntimeSchema);
      else {
        unknownCreation.current = true;
        survey = await surveyRequest("/surveys", { method: "POST", body: input }, SurveyRuntimeSchema);
        created.current = survey.id; unknownCreation.current = false;
      }
      if (current.current !== expected) return;
      await surveyRequest(`/surveys/${encodeURIComponent(survey.id)}/source`, { method: "PUT", body: {
        expectedVersion: survey.version, documents: { design: serializeSurveyDesignMarkdown(input), publication: "# 发布设置\n", reportTemplate: serializeSurveyReportTemplateMarkdown(survey.template) },
      } }, SurveyRuntimeSchema);
      if (current.current !== expected) return;
      await linkProjectResource({ projectId, kind: "survey", resourceId: survey.id });
      if (current.current === expected) onCreated(survey.id);
    } catch (cause) {
      if (current.current === expected) setError(unknownCreation.current ? "创建回执尚不确定。请先在原生问卷列表核对已有草稿，再关联，避免重复创建。" : "问卷创建或关联未完成。已知草稿会保留，可核对后继续；未发布或分享。");
      throw cause;
    } finally { if (current.current === expected) setBusy(false); }
  }
  return <details className="space-y-3 text-13" onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer">根据原型准备调查问卷</summary><div className="mt-3 space-y-3">
    <p className="text-12 text-muted-foreground">复用原生问卷编辑与生成。明确采用后只创建草稿并关联到本测试，发布与分享另行操作。</p>
    {prototypeContext?.scope === scope ? <SurveyAiProposal key={scope} initialText={brief} locked={readOnly || busy || !group.task.trim()} onApply={apply} /> : expanded && !error && <p role="status" className="text-12">正在读取固定原型的已有文字与结构…</p>}
    {!group.task.trim() && <p className="text-12 text-muted-foreground">请先明确并保存本测试的问题与任务。</p>}
    {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    <Link className="text-primary underline" href={`/studio/survey?projectId=${encodeURIComponent(projectId)}`} target="_blank" rel="noreferrer">打开原生问卷列表核对已有草稿</Link>
  </div></details>;
}
