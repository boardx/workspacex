"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { projectResourceHref } from "@/components/project/project-resource-section";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { listProjectResources } from "@/lib/live-project-resources";
import { AidtResearchMaterialPreview } from "./aidt-research-material";
import { AidtTestSurveyCollection } from "./aidt-test-survey-collection";
import { AidtTestGroups } from "./aidt-test-groups";
import { AidtTestPrototypeSource, type AidtReadPrototypeEntity } from "./aidt-test-prototype-source";
import { isAidtTestGroupConfirmed, readAidtTestGroups, type AidtTestGroup } from "../lib/aidt-test-groups";
import { aidtTestGroupFromProposal, applyAidtTestPlan, confirmAidtTestProposal, readAidtTestPlan, readAidtTestProposal, type AidtTestProposal, type AidtTestTurn } from "../lib/aidt-test-proposal";
import { readAidtResearchMaterial } from "../lib/aidt-research-materials";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type OutputProps = {
  projectId: string;
  draft: AidtUiStageDraft;
  activeEntityId: string;
  savedDraft?: AidtUiStageDraft;
  readPrototypeEntity?: AidtReadPrototypeEntity;
  historical?: boolean;
  proposal?: AidtTestProposal | null;
};

type ConversationProps = {
  projectId: string;
  entityId: string;
  draft: AidtUiStageDraft;
  savedDraft?: AidtUiStageDraft;
  messages: readonly AidtTestTurn[];
  loading: boolean;
  running: boolean;
  update: (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean;
  readPrototypeEntity?: AidtReadPrototypeEntity;
  requestSave: () => void;
  canSave?: boolean;
  onProposal?: (proposal: AidtTestProposal | null) => void;
};

const visibleFields = [
  ["task", "测试任务"], ["participant", "参与者代号"], ["situation", "测试情境"],
  ["sourceLocation", "来源位置"], ["said", "原话或原始回答"], ["did", "现场观察"],
  ["interpretation", "学生解释"], ["reflection", "本组反思"], ["afterTestBelief", "测试后看法"], ["evidenceGap", "证据缺口"], ["decisionReason", "反馈处理理由"],
] as const;

function useTestEvidenceAccess(projectId: string, group: AidtTestGroup | undefined) {
  const session = useOptionalSession()?.session;
  const actor = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken]);
  const token = session?.sessionToken;
  const sourceId = group?.source?.id;
  const sourceKind = group?.source?.kind;
  const responseId = group?.surveyResponseId;
  const material = group?.material?.projectId === projectId && (!group.material.mime.startsWith("audio/") || group.audioConsentAt) ? JSON.stringify(group.material) : "";
  const scope = JSON.stringify([projectId, actor, group?.id, sourceId, sourceKind, responseId, material]);
  const [ready, setReady] = React.useState<{ scope: string; source: boolean; response: boolean; material: boolean }>();
  React.useEffect(() => {
    if (!token || (!sourceId && !material)) return;
    const controller = new AbortController();
    const sourceRead = sourceId ? listProjectResources(projectId).then(async result => {
      const source = result.items.some(item => item.id === sourceId && item.kind === sourceKind);
      if (!source || sourceKind !== "survey" || !responseId || controller.signal.aborted) return { source, response: false };
      try {
        const survey = await surveyRequest(`/surveys/${encodeURIComponent(sourceId)}`, { signal: controller.signal, sessionToken: token }, SurveyRuntimeSchema);
        return { source, response: survey.id === sourceId && survey.responses.some(item => item.id === responseId && item.analysis !== "excluded") };
      } catch { return { source, response: false }; }
    }).catch(() => ({ source: false, response: false })) : { source: false, response: false };
    const materialRead = material ? readAidtResearchMaterial({ projectId, sessionToken: token, signal: controller.signal }, JSON.parse(material))
      .then(() => true).catch(() => false) : false;
    void Promise.all([sourceRead, materialRead]).then(([source, evidence]) => {
      if (!controller.signal.aborted) setReady({ scope, ...source, material: evidence });
    });
    return () => controller.abort();
  }, [material, projectId, responseId, scope, sourceId, sourceKind, token]);
  return ready?.scope === scope ? ready : null;
}

export function AidtTestConversation({ projectId, entityId, draft, savedDraft, messages, loading, running, update, readOnly, readPrototypeEntity, requestSave, canSave = true, onProposal }: ConversationProps) {
  const group = readAidtTestGroups(draft.fields).find(item => item.id === entityId && !item.archived);
  const saved = readAidtTestGroups(savedDraft?.fields ?? {}).find(item => item.id === entityId && !item.archived);
  const proposal = React.useMemo(() => loading || running ? null : readAidtTestProposal(messages, entityId), [entityId, loading, messages, running]);
  const plan = React.useMemo(() => loading || running ? null : readAidtTestPlan(messages, entityId), [entityId, loading, messages, running]);
  const access = useTestEvidenceAccess(projectId, group);
  const sourceAccessible = Boolean(access?.material || (group?.method === "survey" && access?.response));
  const session = useOptionalSession()?.session;
  const pending = React.useRef<{ entityId: string; messageId: string } | null>(null);
  const completed = saved && isAidtTestGroupConfirmed(saved);
  const stagedConfirmation = group?.confirmedFromMessageId;
  const retry = Boolean(proposal && stagedConfirmation === proposal.messageId && saved?.confirmedFromMessageId !== proposal.messageId);
  React.useEffect(() => {
    if (!plan || !canSave || readOnly || !group || group.confirmedFromMessageId || group.planFromMessageId === plan.messageId) return;
    update(current => applyAidtTestPlan(current, plan));
    requestSave();
  }, [canSave, group, plan, readOnly, requestSave, update]);
  React.useEffect(() => {
    onProposal?.(proposal);
  }, [onProposal, proposal]);
  React.useEffect(() => {
    if (!pending.current) return;
    if (pending.current.entityId !== entityId || readOnly) { pending.current = null; return; }
    if (canSave && pending.current.messageId === stagedConfirmation) {
      pending.current = null;
      requestSave();
    }
  }, [canSave, entityId, readOnly, requestSave, stagedConfirmation]);
  if (!group) return null;
  const proposed = proposal && aidtTestGroupFromProposal(group, proposal, sourceAccessible, access?.material);
  return <section className="space-y-2" aria-label="测试成果确认" data-testid="aidt-test-chat-confirmation">
    {session?.sessionToken && session.userId && <AidtTestPrototypeSource group={group} context={{ projectId, sessionToken: session.sessionToken, userId: session.userId }} readPrototypeEntity={readPrototypeEntity} showQuestion />}
    {!readOnly && <details className="text-12">
      <summary className="cursor-pointer text-muted-foreground">关联测试材料</summary>
      <AidtTestGroups projectId={projectId} activeEntityId={entityId} draft={draft} readOnly={readOnly}
        update={update} sourcesOnly onSourceChange={requestSave} />
    </details>}
    {(proposal || completed) && <div className="flex flex-wrap items-center gap-2">
      {proposal && !readOnly && saved?.confirmedFromMessageId !== proposal.messageId && <Button type="button" variant="primary" disabled={!canSave || !proposed} onClick={() => {
        if (!proposed || !canSave) return;
        if (retry) { requestSave(); return; }
        pending.current = { entityId, messageId: proposal.messageId };
        const evidence = JSON.stringify([group.source, group.material, group.surveyResponseId]);
        update(current => {
          const latest = readAidtTestGroups(current.fields).find(item => item.id === entityId);
          if (!latest || JSON.stringify([latest.source, latest.material, latest.surveyResponseId]) !== evidence) return current;
          return confirmAidtTestProposal(current, proposal, sourceAccessible, access?.material);
        });
      }}>{retry ? "重试保存测试成果" : "确认并保存测试成果"}</Button>}
      <span role="status" className="text-12 text-muted-foreground">{retry ? "确认尚未保存。" : proposal && !proposed ? "请在对话中核对来源或说明证据缺口。" : completed ? "已确认并保存。" : "核对右侧草稿后确认。"}</span>
    </div>}
  </section>;
}

export function AidtTestGroupOutput({ projectId, draft, activeEntityId, savedDraft, readPrototypeEntity, proposal, historical }: OutputProps) {
  const group = readAidtTestGroups(draft.fields).find(item => item.id === activeEntityId && (historical || !item.archived));
  const session = useOptionalSession()?.session;
  const access = useTestEvidenceAccess(projectId, group);
  if (!group) return <p role="status" className="text-12">找不到测试记录。</p>;
  const proposed = proposal?.result.entityId === group.id && proposal.messageId !== group.confirmedFromMessageId;
  const shown = proposed && proposal ? { ...group, ...proposal.result, afterTestBelief: proposal.result.round?.afterTestBelief,
    understandingChange: proposal.result.round?.understandingChangeStatus } : group;
  const mayShowStatement = access?.material || (group.method === "survey" && access?.response)
    || (!group.surveyResponseId && !proposed && group.method === "survey" && access?.source);
  const fields = visibleFields.filter(([key]) => shown[key]?.trim() && (key !== "said" || mayShowStatement)
    && (key !== "did" || access?.material));
  const primaryFields = fields.filter(([key]) => key === "task" || key === "reflection" || key === "afterTestBelief" || key === "evidenceGap");
  const evidenceFields = fields.filter(([key]) => !primaryFields.some(([field]) => field === key));
  const saved = readAidtTestGroups(savedDraft?.fields ?? {}).find(item => item.id === activeEntityId && (historical || !item.archived));
  const confirmed = isAidtTestGroupConfirmed(group);
  const status = proposed ? "AI 草稿 · 待确认" : confirmed
    ? saved?.confirmedFromMessageId === group.confirmedFromMessageId ? "已确认" : "待保存"
    : "待整理";
  return <section aria-label="测试产物" className="space-y-3" data-testid="aidt-test-group-detail">
    <div className="flex items-start justify-between gap-2">
      <h4 className="break-words text-16 font-semibold">{group.name || "测试成果"}</h4>
      <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-11 text-muted-foreground">{status}</span>
    </div>
    {!fields.length && <p className="text-13 text-muted-foreground">讨论后，测试草稿会出现在这里。</p>}
    {primaryFields.length > 0 && <dl className="space-y-3">{primaryFields.map(([key, title]) => <div key={key}>
      <dt className="text-12 font-medium">{title}</dt>
      <dd className="whitespace-pre-wrap break-words text-13">{shown[key]}</dd>
    </div>)}</dl>}
    {shown.understandingChange && <p className="text-12">{({ changed: "认识有变化", unchanged: "先前看法暂未改变", insufficient: "证据不足" })[shown.understandingChange]}</p>}
    {proposal && proposed && proposal.result.round && <p className="text-12 text-muted-foreground">下一动作草稿 · {proposal.result.round.nextAction || proposal.result.round.returnReason}</p>}
    <details className="border-t border-border pt-2 text-12">
      <summary className="cursor-pointer text-muted-foreground">原型版本与来源</summary>
      {evidenceFields.length > 0 && <dl className="mt-2 space-y-2">{evidenceFields.map(([key, title]) => <div key={key}><dt className="font-medium">{title}</dt><dd className="whitespace-pre-wrap break-words">{shown[key]}</dd></div>)}</dl>}
      {session?.sessionToken && session.userId && <AidtTestPrototypeSource group={group} context={{ projectId, sessionToken: session.sessionToken, userId: session.userId }} readPrototypeEntity={readPrototypeEntity} />}
      {group.source && access?.source && <Link className="text-primary underline" href={projectResourceHref(group.source.kind, group.source.id, projectId)}>打开关联资料</Link>}
      {group.source?.kind === "survey" && access?.source && <AidtTestSurveyCollection key={group.source.id} projectId={projectId} surveyId={group.source.id} responseId={group.surveyResponseId} />}
      {group.source && access && !access.source && <p className="text-muted-foreground">当前无权读取已关联来源。</p>}
      {group.material && access?.material && <AidtResearchMaterialPreview projectId={projectId} reference={group.material} quote={group.said} />}
    </details>
  </section>;
}
