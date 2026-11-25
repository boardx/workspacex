"use client";

import * as React from "react";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtCandidatePicker } from "./aidt-candidate-picker";
import { useAidtCandidateRequest, type AidtCandidateAdopter } from "../lib/use-aidt-candidate-request";
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
type DiscussionField = keyof typeof AIDT_PROTOTYPE_DISCUSSION_FIELDS;
function discussionFields(value: Record<string, unknown>): Candidate["fields"] {
  const fields: Candidate["fields"] = {};
  for (const key of Object.keys(AIDT_PROTOTYPE_DISCUSSION_FIELDS) as DiscussionField[]) {
    const text = value[key];
    if (typeof text === "string" && text.trim() && text.length <= 400) fields[key] = text.trim();
  }
  return fields;
}
function formatDiscussion(fields: Candidate["fields"]) {
  return Object.entries(fields).map(([key, text]) => `${AIDT_PROTOTYPE_DISCUSSION_FIELDS[key as DiscussionField]}：${text}`);
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function readAidtPrototypeTextCandidates(text: string): readonly Candidate[] {
  for (const block of text.matchAll(/\x60\x60\x60(?:aidt-prototype|json)[ \t]*\r?\n([\s\S]+?)\r?\n\x60\x60\x60/gi)) {
    try {
      const value = asRecord(JSON.parse(block[1]!));
      if (!value) continue;
      const fields = discussionFields(value);
      const sections = formatDiscussion(fields);
      if (Array.isArray(value.candidates)) {
        for (const item of value.candidates) {
          const idea = asRecord(item);
          if (!idea) continue;
          const lines = formatDiscussion(discussionFields(idea));
          if (typeof idea.ideaDescription === "string" && idea.ideaDescription.trim() && idea.ideaDescription.length <= 400)
            lines.unshift(`点子说明：${idea.ideaDescription.trim()}`);
          if (lines.length && typeof idea.ideaTitle === "string" && idea.ideaTitle.trim() && idea.ideaTitle.length <= 120)
            sections.push([`点子：${idea.ideaTitle.trim()}`, ...lines].join("\n"));
        }
      }
      const result = sections.join("\n\n");
      if (result && result.length <= AIDT_PROTOTYPE_TEXT_MAX_CHARS) return [{ text: result, fields }];
    } catch { /* Try the next structured block. */ }
  }
  return [];
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
      context, "用 aidt-prototype JSON 围栏返回已知的验证问题、先前看法、依据、范围、原型形式、情境、任务、接触点、操作和制作要求字段；按单个 JSON 对象提供整份草稿，字段值为字符串；涉及多个点子时，在各字段中注明点子名称与对应内容。正文合计不超过2000字，不写任何确认或版本字段。"].join("\n\n"),
    parseReply: readAidtPrototypeTextCandidates,
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
  const adopt = React.useCallback<AidtCandidateAdopter<Candidate>>(async (candidate, provenance) => {
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
  }, [designId, draft.fields, onAdopt, projectId, savedRevision]);
  const hasExisting = !!draft.fields.prototypeTextDesign?.trim();
  const autoAttempted = React.useRef<readonly Candidate[]>();
  React.useEffect(() => {
    if (hasExisting || !controller.candidates.length || controller.busy || autoAttempted.current === controller.candidates) return;
    if (controller.selectedIndex === null) {
      controller.choose(0);
      return;
    }
    autoAttempted.current = controller.candidates;
    void controller.adopt(adopt);
  }, [controller, hasExisting, adopt]);

  return <AidtCandidatePicker title="文字设计候选" actionLabel="帮我整理文字设计" controller={controller}
    hasExisting={hasExisting} adoptLabel="采用为可编辑文字草稿"
    renderCandidate={candidate => <p className="whitespace-pre-wrap break-words">{candidate.text}</p>}
    onAdopt={adopt} />;
}
