"use client";

import * as React from "react";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtCandidatePicker } from "./aidt-candidate-picker";
import { useAidtCandidateRequest } from "../lib/use-aidt-candidate-request";
import { readAidtStage } from "../lib/live-aidt-stages";
import { AIDT_PROTOTYPE_DISCUSSION_FIELDS, readAidtPrototypeEntityDraft, readAidtPrototypeInputSelection } from "../lib/aidt-prototype-handoff";
import { loadAidtPrototypeTextSources, type AidtPrototypeSources } from "../lib/aidt-prototype-text-sources";
import { AIDT_PROTOTYPE_TEXT_MAX_CHARS, editAidtPrototypeText, readAidtPrototypeLineage } from "../lib/aidt-prototype-text-state";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Turn = { id: string; role: string; content?: unknown };
type Candidate = { text: string; fields: Partial<Record<keyof typeof AIDT_PROTOTYPE_DISCUSSION_FIELDS, string>> };
type Props = { projectId: string; designId: string; savedRevision?: number; matchesServer: boolean; draft: AidtUiStageDraft;
  sources?: AidtPrototypeSources; loading: boolean; running: boolean; readOnly: boolean; messages: readonly Turn[];
  onAdopt: (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void };

function sourceKey(projectId: string, designId: string, revision: number, selection: string, sources: AidtPrototypeSources) {
  return JSON.stringify({ projectId, designId, stage5Revision: revision, selection, lineage: sources.lineage, items: sources.items });
}
function candidates(text: string): readonly Candidate[] {
  const block = /\x60\x60\x60aidt-prototype\s*\n([\s\S]+?)\n\x60\x60\x60/i.exec(text)?.[1];
  if (!block) return [];
  try {
    const values: unknown = JSON.parse(block);
    if (!values || typeof values !== "object" || Array.isArray(values)) return [];
    const fields = values as Record<string, unknown>;
    const proposal: Candidate["fields"] = {};
    const result = Object.entries(AIDT_PROTOTYPE_DISCUSSION_FIELDS).flatMap(([key, label]) => {
      const value = fields[key];
      if (typeof value === "string" && value.trim() && value.length <= 400) proposal[key as keyof typeof proposal] = value.trim();
      return typeof value === "string" && value.trim() && value.length <= 400 ? [`${label}：${value.trim()}`] : [];
    }).join("\n\n");
    return result && result.length <= AIDT_PROTOTYPE_TEXT_MAX_CHARS ? [{ text: result, fields: proposal }] : [];
  } catch { return []; }
}

/** The shared native sender owns nonce/thread/run checks. This adapter only
 * supplies authorized, exact-revision S5 source text and a local adoption action. */
export function AidtPrototypeTextCandidates(props: Props) {
  const { projectId, designId, draft, sources, savedRevision, matchesServer, readOnly, loading, running, messages, onAdopt } = props;
  const session = useOptionalSession()?.session;
  const identity = JSON.stringify([projectId, designId, session?.currentOrgId, session?.userId, session?.sessionToken,
    draft.fields.prototypeTextDesign, draft.fields.prototypeTextVersion, draft.fields.prototypeIdeaSource, draft.fields.prototypeTextLineage]);
  const current = React.useRef(identity); current.current = identity;
  React.useEffect(() => { current.current = identity; return () => { current.current = "unmounted"; }; }, [identity]);
  const authorized = sources && !sources.restricted && savedRevision && draft.fields.prototypeIdeaSource
    ? sourceKey(projectId, designId, savedRevision, draft.fields.prototypeIdeaSource, sources) : null;
  const context = sources?.items.map(item => [`点子：${item.title}（${item.ideaId}）`,
    ...item.views.map(view => `第${view.reference.stageId}步 V${view.reference.revision} / ${view.reference.entityId}\n${view.text}`),
    `来源缺口：${item.missing.join("；") || "没有已记录缺口"}`].join("\n\n")).join("\n\n") ?? "";
  const controller = useAidtCandidateRequest({
    kind: "prototype", projectId, entityId: designId, sourceKey: authorized, messages, loading, running,
    enabled: !readOnly && matchesServer && !!authorized && context.length <= 8000,
    disabledReason: context.length > 8000 ? "本轮来源较长，请缩小本轮组合或手写文字设计；不会截断研究材料。" : "先保存本轮点子来源并核对当前资料授权。",
    instruction: ["请根据以下当前项目、逐点子固定版本的授权材料，协助整理一份可编辑文字设计候选。保留不同点子的各自来源，不替学生选择、确认或保存，不生成图片或网页。缺材料明确说明，不补造研究事实。",
      context, "用 aidt-prototype JSON 围栏返回已知的验证问题、先前看法、依据、范围、原型形式、情境、任务、接触点、操作和制作要求字段；正文合计不超过2000字，不写任何确认或版本字段。"].join("\n\n"),
    parseReply: candidates,
    readCurrentSource: async signal => {
      if (!session?.sessionToken || !savedRevision || !matchesServer) return null;
      const { stage } = await readAidtStage(projectId, 5, session.sessionToken, signal);
      if (!stage || stage.projectId !== projectId || stage.revision !== savedRevision) return null;
      const current = readAidtPrototypeEntityDraft(stage.content.draft, designId);
      const selection = current && readAidtPrototypeInputSelection(current);
      if (!current || !selection || current.fields.prototypeArchived === "true") return null;
      const loaded = await loadAidtPrototypeTextSources({ projectId, sessionToken: session.sessionToken, selection,
        lineage: readAidtPrototypeLineage(current) ?? undefined, signal });
      return loaded.restricted ? null : sourceKey(projectId, designId, stage.revision, current.fields.prototypeIdeaSource!, loaded);
    },
  });
  return <AidtCandidatePicker title="文字设计候选" actionLabel="帮我整理文字设计" controller={controller}
    hasExisting={!!draft.fields.prototypeTextDesign?.trim()} adoptLabel="采用为可编辑文字草稿"
    renderCandidate={candidate => <p className="whitespace-pre-wrap break-words">{candidate.text}</p>}
    onAdopt={async (candidate, provenance) => {
      const expected = current.current;
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(provenance.sourceKey))), byte => byte.toString(16).padStart(2, "0")).join("");
      if (current.current !== expected || provenance.projectId !== projectId || provenance.entityId !== designId) throw new Error("AIDT_CONTEXT_CHANGED");
      onAdopt(old => {
        if (old.fields.prototypeTextVersion !== draft.fields.prototypeTextVersion || old.fields.prototypeTextDesign !== draft.fields.prototypeTextDesign
          || old.fields.prototypeIdeaSource !== draft.fields.prototypeIdeaSource || old.fields.prototypeTextLineage !== draft.fields.prototypeTextLineage) return old;
        const next = editAidtPrototypeText(old, candidate.text, crypto.randomUUID());
        return { ...next, fields: { ...next.fields, prototypeDiscussionProposal: JSON.stringify(candidate.fields), prototypeTextCandidateSource: JSON.stringify({ kind: provenance.kind, projectId: provenance.projectId,
          entityId: provenance.entityId, threadId: provenance.threadId, requestId: provenance.requestId, messageId: provenance.messageId,
          sourceKeySha256: digest, stage5Revision: savedRevision }) } };
      });
    }} />;
}
