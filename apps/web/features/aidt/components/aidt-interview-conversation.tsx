"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  aidtInterviewFindingReady,
  confirmAidtInterviewFinding,
  getAidtInterviewFinding,
  isAidtInterviewConfirmed,
  readAidtInterviews,
  readAidtInterviewTranscript,
  writeAidtInterviewFinding,
  type AidtInterview,
} from "../lib/aidt-interviews";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtInterviewFieldwork } from "./aidt-interview-workspace";

type Turn = { id: string; role: string; content?: unknown };
type UpdateDraft = (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;

/** Prefer explicitly framed guides. A conversational follow-up alone is never a guide. */
export function readAidtInterviewGuideDraft(message: string) {
  const block = /(?:^|\n)```aidt-interview-guide[ \t]*\n([\s\S]*?)\n```(?=\n|$)/u.exec(message);
  const lines = block?.[1]?.split("\n") ?? message.split("\n").filter(line => /^\s*\d+[.、)）]\s*.+[?？]\s*$/u.test(line));
  const questions = lines.map(line => line.trim()).filter(Boolean);
  const guide = questions.join("\n");
  return questions.length >= (block ? 1 : 2) && guide.length <= 1000 ? guide : "";
}

export function AidtInterviewConversation({ interview, messages, loading, running, onApply, draft, savedDraft, projectId, readOnly = false, requestSave, update }: {
  interview: AidtInterview; messages: readonly Turn[]; loading: boolean; running: boolean;
  onApply: (patch: Partial<AidtInterview>) => void;
  draft?: AidtUiStageDraft; savedDraft?: AidtUiStageDraft; projectId?: string; readOnly?: boolean;
  requestSave?: () => void; update?: UpdateDraft;
}) {
  const turns = React.useMemo(() => messages.filter((turn): turn is Turn & { content: string } =>
    (turn.role === "assistant" || turn.role === "user") && typeof turn.content === "string" && !!turn.content.trim()), [messages]);
  const initial = turns.find(turn => turn.role === "user")?.content.trim() ?? "";
  const last = turns.at(-1);
  const [selected, setSelected] = React.useState("");
  const [edited, setEdited] = React.useState<string | null>(null);
  const [findingMessage, setFindingMessage] = React.useState("");
  const recorded = Boolean(interview.original.trim());

  React.useEffect(() => {
    if (readOnly || loading || running || interview.guideConfirmed) return;
    if (!recorded && initial && initial.length <= 1000) onApply({ original: initial });
    if (interview.adopted || last?.role !== "assistant") return;
    const proposal = readAidtInterviewGuideDraft(last.content);
    if (proposal) onApply({ adopted: proposal });
  }, [initial, loading, running, recorded, readOnly, interview.adopted, interview.guideConfirmed, last?.role, last?.content, onApply]);

  React.useEffect(() => {
    if (readOnly || loading || !interview.guideConfirmed || !interview.consent?.notes || !draft || !update) return;
    const transcript = readAidtInterviewTranscript(draft.fields, interview.id);
    if (!transcript?.checked || getAidtInterviewFinding(draft, interview).headline) return;
    const studentObservation = [...turns].reverse().filter(turn => turn.role === "user")
      .map(turn => /^(?:访谈发现|发现|观察)[：:]\s*([\s\S]+)$/u.exec(turn.content.trim())?.[1]?.trim())
      .find(value => value && value.length <= 1700);
    if (studentObservation) update(old => writeAidtInterviewFinding(old, interview, {
      headlineKind: "student-summary", headline: Array.from(studentObservation).slice(0, 500).join(""), context: studentObservation, quote: "",
    }));
  }, [draft, interview, loading, readOnly, turns, update]);

  if (loading || readOnly) return null;
  if (interview.guideConfirmed && draft && update && projectId) {
    const persisted = savedDraft && readAidtInterviews(savedDraft.fields).find(item => item.id === interview.id);
    const savedGuide = persisted?.guideConfirmed && persisted.adopted === interview.adopted;
    const savedFinding = savedDraft && isAidtInterviewConfirmed(savedDraft.fields, interview.id);
    const finding = getAidtInterviewFinding(draft, interview);
    const ready = aidtInterviewFindingReady(draft, interview, projectId);
    const confirmed = isAidtInterviewConfirmed(draft.fields, interview.id);
    const findings = turns.filter(turn => turn.role === "user" && turn.content.trim() !== interview.original.trim() && turn.content.trim().length <= 1700);
    return <section aria-label="访谈进度" className="space-y-3 rounded-container border border-border p-3 text-13">
      <p role="status">{savedFinding && confirmed ? "访谈已完成" : savedGuide ? "问题清单已确认" : "问题清单等待保存"}</p>
      <details className="space-y-3">
        <summary className="cursor-pointer font-medium">访谈材料与授权</summary>
        <AidtInterviewFieldwork interview={interview} draft={draft} update={update} projectId={projectId} readOnly={readOnly} />
        {requestSave && <Button type="button" variant="outline" size="sm" onClick={requestSave}>保存材料</Button>}
      </details>
      {interview.consent?.notes && !confirmed && <div className="space-y-2">
        <label className="block">从聊天选择学生观察
          <select className="mt-1 w-full rounded-control border border-border bg-background p-2" value={findingMessage} onChange={event => {
            const id = event.currentTarget.value;
            setFindingMessage(id);
            const observation = findings.find(turn => turn.id === id)?.content.trim();
            if (observation) update(old => writeAidtInterviewFinding(old, interview, {
              headlineKind: "student-summary", headline: Array.from(observation).slice(0, 500).join(""), context: observation, quote: "",
            }));
          }}>
            <option value="">选择发在此访谈的观察</option>
            {findings.map(turn => <option key={turn.id} value={turn.id}>{turn.content.slice(0, 60)}</option>)}
          </select>
        </label>
        {finding.headline && <Button type="button" size="sm" variant="primary" disabled={!ready || running} onClick={() => {
          update(old => confirmAidtInterviewFinding(old, interview.id, projectId));
          requestSave?.();
        }}>确认并完成访谈</Button>}
      </div>}
      {confirmed && !savedFinding && requestSave && <Button type="button" size="sm" variant="primary" onClick={requestSave}>保存确认</Button>}
      {savedFinding && confirmed && <Button type="button" size="sm" variant="outline" onClick={() => update(old => writeAidtInterviewFinding(old, interview, {}))}>修改发现</Button>}
      {!savedGuide && requestSave && <Button type="button" size="sm" variant="primary" onClick={requestSave}>保存清单</Button>}
      {savedGuide && <Button type="button" size="sm" variant="outline" onClick={() => onApply({ guideConfirmed: false })}>修改清单</Button>}
    </section>;
  }

  if (running || !turns.length || interview.guideConfirmed) return null;
  const text = edited ?? interview.adopted;
  return <section aria-label="从对话整理清单" className="space-y-2 rounded-container border border-border p-3 text-13">
    {!recorded && initial.length > 1000 && <p>请在聊天里发一份 1000 字以内的问题。</p>}
    <label className="block">从对话选取问题
      <select className="mt-1 w-full rounded-control border border-border bg-background p-2" value={selected} onChange={event => {
        const id = event.currentTarget.value;
        setSelected(id);
        setEdited(turns.find(turn => turn.id === id)?.content ?? null);
      }}>
        <option value="">选择一条消息</option>
        {turns.map(turn => <option key={turn.id} value={turn.id}>{turn.role === "user" ? "小组" : "AI"} · {turn.content.slice(0, 60)}</option>)}
      </select>
    </label>
    {(selected || text) && <>
      <label className="block">保留要问的问题，每行一题<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" rows={4} value={text} onChange={event => setEdited(event.currentTarget.value)} /></label>
      {text.trim().length > 1000 && <p role="status">请将问题清单整理到 1000 字以内。</p>}
      <Button size="sm" variant="primary" type="button" disabled={!recorded || !text.trim() || text.trim().length > 1000} onClick={() => {
        onApply({ adopted: text.trim(), guideConfirmed: true });
        requestSave?.();
        setSelected("");
        setEdited(null);
      }}>确认这份问题清单</Button>
    </>}
  </section>;
}
