"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { isAidtInterviewArchived, readAidtInterviews, writeAidtInterview, type AidtInterview } from "../lib/aidt-interviews";
type InterviewChatTurn = { id: string; role: string; content?: unknown };
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtInterviewWorkspace } from "./aidt-interview-workspace";

type Update = (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;

function GuideDecision({ interview, update }: { interview: AidtInterview; update: Update }) {
  const [items, setItems] = React.useState(() => interview.adopted.split(/\n+/).filter(Boolean).map(text => ({ text, selected: true })));
  const [editing, setEditing] = React.useState<number | null>(null);
  if (!items.length) return null;
  const chosen = items.filter(item => item.selected).map(item => item.text.trim()).filter(Boolean).join("\n");
  return <section aria-label="核对访谈问题" className="space-y-2 text-13"><h4 className="font-semibold">访谈问题清单</h4>
    {items.map((item, i) => <div key={i} data-testid="aidt-interview-chat-question" className="flex flex-wrap items-start gap-2">
      <label className="flex min-w-0 flex-1 items-start gap-2"><input type="checkbox" className="mt-1" checked={item.selected} onChange={event => {
        const selected = event.currentTarget.checked; setItems(items => items.map((value, index) => index === i ? { ...value, selected } : value));
      }} /><span>{item.text}</span></label>
      <Button size="xs" variant="ghost" onClick={() => setEditing(editing === i ? null : i)}>编辑这道问题</Button>
      {editing === i && <label className="w-full">修改问题<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" maxLength={1000} value={item.text} onChange={event => {
        const text = event.currentTarget.value; setItems(items => items.map((value, index) => index === i ? { ...value, text } : value));
      }} /></label>}
    </div>)}
    {chosen.length > 1000 && <p role="status">请将清单整理到 1000 字以内。</p>}
    <Button size="sm" disabled={!chosen || chosen.length > 1000 || (interview.guideConfirmed && chosen === interview.adopted)} onClick={() => update(draft => {
      const current = readAidtInterviews(draft.fields).find(item => item.id === interview.id);
      return current && current.adopted === interview.adopted && !isAidtInterviewArchived(draft.fields, current.id) ? writeAidtInterview(draft, { ...current, adopted: chosen, guideConfirmed: true }) : draft;
    })}>{interview.guideConfirmed && chosen === interview.adopted ? "已确认问题清单" : "确认这份问题清单"}</Button>
    {interview.guideConfirmed && <Button type="button" size="sm" variant="ghost" onClick={() => update(draft => {
      const current = readAidtInterviews(draft.fields).find(item => item.id === interview.id);
      return current && current.guideConfirmed && !isAidtInterviewArchived(draft.fields, current.id) ? writeAidtInterview(draft, { ...current, guideConfirmed: false }) : draft;
    })}>继续迭代问题</Button>}
  </section>;
}

export function AidtInterviewConversation({ projectId, interview, draft, messages, loading, running, update, onSettled }: {
  projectId: string; interview: AidtInterview; draft: AidtUiStageDraft; messages: readonly InterviewChatTurn[]; loading: boolean; running: boolean;
  update: Update; onSettled: (messageId: string) => void;
}) {
  React.useEffect(() => {
    if (loading || running) return;
    const last = messages.at(-1);
    if (last?.role === "assistant" && last.id) onSettled(last.id);
  }, [loading, running, messages, onSettled]);
  if (loading || running || (!interview.original && !interview.adopted && !interview.consent)) return null;
  return <section data-testid="aidt-interview-chat-actions" aria-label="本次访谈的对话操作" className="mx-auto w-full max-w-3xl space-y-3 px-4 py-2">
    <GuideDecision key={JSON.stringify([interview.id, interview.adopted])} interview={interview} update={update} />
    {interview.consent?.notes && <AidtInterviewWorkspace projectId={projectId} entityId={interview.id} draft={draft} update={update} readOnly={false} surface="finding" />}

  </section>;
}
