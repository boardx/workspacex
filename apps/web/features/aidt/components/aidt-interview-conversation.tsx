"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtInterview } from "../lib/aidt-interviews";

type Turn = { id: string; role: string; content?: unknown };

export function AidtInterviewConversation({ interview, messages, loading, running, onApply }: {
  interview: AidtInterview; messages: readonly Turn[]; loading: boolean; running: boolean;
  onApply: (patch: Partial<AidtInterview>) => void;
}) {
  const turns = messages.filter((turn): turn is Turn & { content: string } =>
    (turn.role === "assistant" || turn.role === "user") && typeof turn.content === "string" && !!turn.content.trim());
  const initial = turns.find(turn => turn.role === "user")?.content.trim() ?? "";
  const [selected, setSelected] = React.useState("");
  const [text, setText] = React.useState("");
  const recorded = Boolean(interview.original.trim());
  // Wait for canonical history. Keep the first draft even when the student later rewrites it.
  React.useEffect(() => {
    if (!loading && !recorded && !interview.consent && !interview.guideConfirmed && initial && initial.length <= 1000) onApply({ original: initial });
  }, [initial, loading, recorded, interview.consent, interview.guideConfirmed, onApply]);
  if (loading || running || !turns.length || interview.guideConfirmed) return null;
  const oversized = !recorded && initial.length > 1000;
  return <section aria-label="从对话整理清单" className="space-y-2 text-13">
    {oversized && <p>首条消息超过原稿字段的 1000 字限制。可展开「编辑提纲」选录原题，完整内容保留在对话中。</p>}
    <label className="block">从对话选取问题
      <select className="mt-1 w-full rounded-control border border-border bg-background p-2" value={selected} onChange={event => {
        const id = event.currentTarget.value;
        setSelected(id);
        setText(turns.find(turn => turn.id === id)?.content ?? "");
      }}>
        <option value="">选择一条消息</option>
        {turns.map(turn => <option key={turn.id} value={turn.id}>{turn.role === "user" ? "小组" : "AI"} · {turn.content.slice(0, 60)}</option>)}
      </select>
    </label>
    {selected && <>
      <label className="block">保留要问的问题，每行一题<textarea className="mt-1 w-full rounded-control border border-border p-2" rows={4} value={text} onChange={event => setText(event.currentTarget.value)} /></label>
      {text.trim().length > 1000 && <p role="status">请将问题清单整理到 1000 字以内。</p>}
      <Button size="sm" type="button" disabled={!recorded || !text.trim() || text.trim().length > 1000} onClick={() => {
        onApply({ adopted: text.trim(), guideConfirmed: true });
        setSelected(""); setText("");
      }}>确认这份问题清单</Button>
    </>}
  </section>;
}
