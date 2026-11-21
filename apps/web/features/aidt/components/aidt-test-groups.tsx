"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalSession } from "@/components/session/session-provider";
import { projectResourceHref, startNewProjectResource } from "@/components/project/project-resource-section";
import { listProjectResources, type ProjectResourceItem } from "@/lib/live-project-resources";
import { AidtInterviewRecorder } from "./aidt-interview-recorder";
import { AidtTestSurveyCollection } from "./aidt-test-survey-collection";
import { AidtTestPrototypeSource, type AidtReadPrototypeEntity } from "./aidt-test-prototype-source";
import { AidtResearchMaterialControl, AidtResearchMaterialPreview } from "./aidt-research-material";
import { aidtTestGroupHasEvidence, readAidtTestGroups, updateAidtTestGroup, type AidtTestGroup } from "../lib/aidt-test-groups";
import { readAidtResearchMaterial } from "../lib/aidt-research-materials";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { readAidtQuestionSnapshot, updateAidtReflectionField } from "../lib/aidt-verification-loop";

type Props = {
  projectId: string;
  draft: AidtUiStageDraft;
  activeEntityId: string;
  readPrototypeEntity?: AidtReadPrototypeEntity;
  readOnly: boolean;
  sourcesOnly?: boolean;
  onSourceChange?: () => void;
  update: (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
};

const groupFields = [
  ["name", "测试组名称", 80],
  ["participant", "参与者代号", 80],
  ["situation", "测试情境", 300],
  ["task", "测试任务与追问", 300],
  ["sourceLocation", "原件位置（时间点、答卷或批次）", 180],
  ["said", "原话或问卷原始回答", 500],
  ["did", "现场观察到的行为", 500],
  ["interpretation", "学生解释", 500],
  ["reflection", "学生对本组测试的反思", 400],
] as const;

export function AidtTestGroups(props: Props) {
  const session = useOptionalSession()?.session;
  if (!session?.sessionToken || !session.userId || !session.currentOrgId) return null;
  const key = JSON.stringify([props.projectId, session.currentOrgId, session.userId, session.sessionToken, props.readOnly, props.activeEntityId]);
  return <TestGroups key={key} {...props} sessionToken={session.sessionToken} userId={session.userId} />;
}

function TestGroups({ projectId, draft, readOnly, sourcesOnly, update, onSourceChange, activeEntityId, readPrototypeEntity, sessionToken, userId }: Props & { sessionToken: string; userId: string }) {
  const [retry, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [resources, setResources] = React.useState<ProjectResourceItem[] | "failed" | null>(null);
  const group = readAidtTestGroups(draft.fields).find(item => item.id === activeEntityId && !item.archived);
  const hasGroup = Boolean(group);
  const material = group?.material;
  const materialKey = material?.projectId === projectId ? JSON.stringify(material) : null;
  const [verifiedMaterial, setVerifiedMaterial] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!materialKey) return;
    const controller = new AbortController();
    void readAidtResearchMaterial({ projectId, sessionToken, signal: controller.signal }, JSON.parse(materialKey)).then(() => {
      if (!controller.signal.aborted) setVerifiedMaterial(materialKey);
    }, () => { if (!controller.signal.aborted) setVerifiedMaterial(null); });
    return () => controller.abort();
  }, [projectId, sessionToken, materialKey, retry]);
  const [newResource, setNewResource] = React.useState<{ kind: AidtTestGroup["method"]; href: string }>();
  const [resourceLinkFailed, setResourceLinkFailed] = React.useState(false);
  const [materialError, setMaterialError] = React.useState("");
  const currentMethod = group?.method;
  React.useEffect(() => {
    if (readOnly || !currentMethod) return;
    let active = true;
    void startNewProjectResource(currentMethod === "survey" ? "survey" : "itv", projectId).then(href => {
      if (active) { setNewResource({ kind: currentMethod, href }); setResourceLinkFailed(false); }
    }, () => { if (active) setResourceLinkFailed(true); });
    return () => { active = false; };
  }, [projectId, currentMethod, readOnly]);

  React.useEffect(() => {
    if (!hasGroup) return;
    let active = true;
    setResources(null);
    void listProjectResources(projectId).then(result => {
      if (active) setResources(result.items.filter(item => item.kind === "interview" || item.kind === "survey"));
    }, () => { if (active) setResources("failed"); });
    return () => { active = false; };
  }, [projectId, retry, hasGroup]);

  function change(id: string, patch: Partial<AidtTestGroup>) {
    if (readOnly) return;
    update(current => {
      const record = readAidtTestGroups(current.fields).find(item => item.id === id);
      if (!record) return current;
      const others = readAidtTestGroups(current.fields).filter(item => item.id !== id);
      if (patch.source && others.some(item => item.source?.kind === patch.source?.kind && item.source?.id === patch.source?.id)) return current;
      return updateAidtTestGroup(current, { ...record, ...patch });
    });
    onSourceChange?.();
  }

  const otherSources = new Set(readAidtTestGroups(draft.fields)
    .filter(item => item.id !== activeEntityId && item.source?.kind === group?.method).map(item => item.source?.id));
  const options = group && Array.isArray(resources) ? resources.filter(item => item.kind === group.method
    && (item.id === group.source?.id || !otherSources.has(item.id))) : [];
  const source = options.find(item => item.id === group?.source?.id);
  const hasEvidence = group && aidtTestGroupHasEvidence(group, projectId, !!source, !!materialKey && verifiedMaterial === materialKey);
  const snapshot = readAidtQuestionSnapshot(draft);
  const matchesRound = group && snapshot?.sourceStageRevision === group.stage5Revision
    && snapshot?.prototypeDesignId === group.designId && snapshot?.prototypeVersionId === group.versionId;
  return <section aria-label="本轮分组测试" className="space-y-3 rounded-lg border border-border p-3" data-testid="aidt-test-groups">
    <h4 className="text-14 font-semibold">{group?.name || "测试详情"}</h4>
    {!group && <p role="status" className="text-12">测试记录不存在或已归档。</p>}
    {group && <div className="space-y-3 border-t border-border pt-3" data-testid={sourcesOnly ? "aidt-test-group-sources" : "aidt-test-group-detail"}>
      {!sourcesOnly && <AidtTestPrototypeSource group={group} context={{ projectId, sessionToken, userId }} readPrototypeEntity={readPrototypeEntity} />}
      <label className="block text-12">测试方式
        <select className="mt-1 w-full rounded-md border border-border bg-background p-2" disabled={readOnly} value={group.method} onChange={event => {
          const method = event.currentTarget.value === "survey" ? "survey" : "interview";
          change(group.id, { method, source: null, material: null, audioConsentAt: undefined, sourceLocation: "", surveyResponseId: undefined, said: "", did: "", afterTestBelief: undefined, understandingChange: undefined });
        }}><option value="interview">访谈</option><option value="survey">问卷</option></select>
      </label>
      {resources === "failed" ? <p role="alert" className="text-12">项目资料读取失败。 <Button type="button" variant="outline" size="xs" onClick={refresh}>重试读取资料</Button></p> : resources === null ? <p role="status" className="text-12">正在读取已关联的项目资料…</p> : <>
        <label className="block text-12">关联项目{group.method === "survey" ? "问卷" : "访谈"}
          <select className="mt-1 w-full rounded-md border border-border bg-background p-2" disabled={readOnly} value={source?.id ?? ""} onChange={event => {
            const id = event.currentTarget.value;
            if (!id || options.some(item => item.id === id)) change(group.id, { source: id ? { id, kind: group.method } : null, sourceLocation: "", surveyResponseId: undefined, said: "", did: "", afterTestBelief: undefined, understandingChange: undefined });
          }}><option value="">暂未选择</option>{options.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        </label>
        {group.source && !source && <p role="status" className="text-12">已保存的来源目前无法读取，保留引用以便后续核对。</p>}
        {source?.kind === "interview" && <Link className="text-12 text-primary underline" href={projectResourceHref(source.kind, source.id, projectId)}>打开已关联访谈</Link>}
        {source?.kind === "survey" && <AidtTestSurveyCollection key={source.id} projectId={projectId} surveyId={source.id}
          responseId={group.surveyResponseId} canEdit={!readOnly} onSelect={(responseId, locator) => change(group.id, {
            surveyResponseId: responseId, sourceLocation: locator, said: "", did: "", afterTestBelief: undefined, understandingChange: undefined,
          })} />}
        {group.method === "interview" && <div className="space-y-2 text-12">
          <p className="text-muted-foreground">真人访谈请先取得授权，再将录音、转写或观察记录关联到本测试。虚拟访谈仅用于演练。</p>
          {sourcesOnly && !readOnly && <>
            <label className="flex items-start gap-2"><input type="checkbox" checked={Boolean(group.audioConsentAt)}
              onChange={event => change(group.id, event.currentTarget.checked
                ? { audioConsentAt: new Date().toISOString() }
                : { audioConsentAt: undefined, ...(group.material?.mime.startsWith("audio/") ? { material: null, said: "", did: "" } : {}) })} />
              已获得本次访谈录音和保存授权
            </label>
            {group.audioConsentAt && <AidtInterviewRecorder key={group.id} projectId={projectId} participantCode={group.participant || group.name || "测试访谈"} sessionToken={sessionToken}
              disabled={false} asrAllowed={false} onAttached={({ source }) => {
                update(current => {
                  const currentGroup = readAidtTestGroups(current.fields).find(record => record.id === group.id);
                  if (!currentGroup?.audioConsentAt || currentGroup.archived || currentGroup.method !== "interview") return current;
                  return updateAidtTestGroup(current, { ...currentGroup, material: source });
                });
                onSourceChange?.();
              }} />}
          </>}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && newResource?.kind === group.method && <Link className="text-12 text-primary underline" href={newResource.href} target="_blank" rel="noreferrer">在新标签页创建{group.method === "survey" ? "问卷" : "访谈"}</Link>}
          <Button type="button" variant="ghost" size="xs" onClick={refresh}>刷新已关联资料</Button>
        </div>
        {resourceLinkFailed && <p role="alert" className="text-12">未能打开资料创建入口。可从项目内容进入对应工具。</p>}
        {!options.length && <p className="text-12 text-muted-foreground">新建并关联后，刷新并选择项目中的真实资料。</p>}
      </>}
      {!sourcesOnly && groupFields.map(([field, label, maxLength]) => <label key={field} className="block space-y-1 text-12">
        <span>{label}</span>
        {maxLength <= 80
          ? <Input value={group[field]} maxLength={maxLength} disabled={readOnly} onChange={event => change(group.id, { [field]: event.currentTarget.value })} />
          : <Textarea rows={2} value={group[field]} maxLength={maxLength} disabled={readOnly} onChange={event => change(group.id, { [field]: event.currentTarget.value })} />}
      </label>)}
      {!sourcesOnly && group.method === "survey" && <p className="text-12 text-muted-foreground">问卷自报写在原始回答；只有现场实际观察才填写行为。</p>}
      <AidtResearchMaterialControl projectId={projectId} label="本组原始材料" value={group.material} readOnly={readOnly} selectionScope={group.id} onChange={material => {
        const needsConsent = material?.mime.startsWith("audio/") && !group.audioConsentAt;
        setMaterialError(needsConsent ? "请先核对本次访谈录音授权。" : "");
        if (!needsConsent) change(group.id, { material });
      }} />
      {materialError && <p role="alert">{materialError}</p>}
      {group.material?.projectId === projectId && (!group.material.mime.startsWith("audio/") || group.audioConsentAt) && <AidtResearchMaterialPreview projectId={projectId} reference={group.material} quote={group.said} />}
      {!sourcesOnly && <><label className="block text-12">反馈处理
        <select className="mt-1 w-full rounded-md border border-border bg-background p-2" disabled={readOnly} value={group.decision} onChange={event => {
          const value = event.currentTarget.value;
          change(group.id, { decision: value === "adopted" || value === "declined" ? value : "pending" });
        }}><option value="pending">待验证</option><option value="adopted">采纳</option><option value="declined">暂不采纳</option></select>
      </label>
      <label className="block space-y-1 text-12">反馈处理理由<Textarea rows={2} value={group.decisionReason} maxLength={350} disabled={readOnly} onChange={event => change(group.id, { decisionReason: event.currentTarget.value })} /></label>
      <p role="status" className="text-12">{hasEvidence ? "已记录反馈和来源位置，待小组核对。" : "待测试或待补充可追溯来源。"}</p>
      {!readOnly && matchesRound && <Button type="button" variant="outline" size="sm" disabled={!hasEvidence} onClick={() => update(current => {
        const line = `${group.name.trim() || "测试组"}（${group.id}） · ${group.sourceLocation.trim()}`;
        const previous = current.fields.understandingEvidence ?? "";
        if (previous.split("\n").includes(line)) return current;
        const next = [previous, line].filter(Boolean).join("\n");
        return next.length <= 5000 ? updateAidtReflectionField(current, "understandingEvidence", next) : current;
      })}>引用到本轮反思</Button>}</>}
    </div>}
  </section>;
}
