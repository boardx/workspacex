"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { loadAidtProjectImageThreads } from "../lib/aidt-image-attachments";

export function AidtImageSourceThread({ projectId, thread, readOnly, onChange, label = "图片来源对话", actionLabel = "从本组其他对话选图" }: { projectId: string; thread: string; readOnly: boolean; onChange: (id: string) => void; label?: string; actionLabel?: string }) {
  const session = useOptionalSession()?.session;
  const [open, setOpen] = React.useState(false), [retry, refresh] = React.useReducer((value: number) => value + 1, 0);
  const identity = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, open, retry]);
  const lifecycle = React.useRef({ identity, generation: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, generation: lifecycle.current.generation + 1 };
  const scope = JSON.stringify([identity, lifecycle.current.generation]);
  const [result, setResult] = React.useState<{ scope: string; items?: { id: string; title: string }[]; failed?: boolean } | null>(null);
  React.useEffect(() => {
    if (!open || !session?.sessionToken) return;
    let current = true; const cancellation = new AbortController();
    void loadAidtProjectImageThreads(projectId, session.sessionToken, cancellation.signal).then(items => { if (current) setResult({ scope, items }); })
      .catch(() => { if (current) setResult({ scope, failed: true }); });
    return () => { current = false; cancellation.abort(); };
  }, [scope, open, projectId, session?.sessionToken]);
  const value = result?.scope === scope ? result : null;
  return <div className="space-y-2">
    <Button type="button" size="sm" variant="ghost" disabled={readOnly} aria-expanded={open} onClick={() => setOpen(value => !value)}>{actionLabel}</Button>
    {open && (!value ? <p role="status" className="text-12">正在读取本组共享对话…</p> : value.failed ? <div role="alert" className="space-y-2 text-12"><p>来源对话读取失败，没有判定为无素材。</p><Button type="button" size="sm" variant="outline" onClick={refresh}>重试来源对话</Button></div> : <label className="block text-12">{label}<select aria-label={label} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" disabled={readOnly} value={thread} onChange={event => { if (!readOnly) onChange(event.currentTarget.value); }}>
      {!value.items?.some(item => item.id === thread) && <option value={thread}>当前对话</option>}
      {value.items?.map(item => <option value={item.id} key={item.id}>{item.title || "本组共享对话"}</option>)}
    </select></label>)}
  </div>;
}
