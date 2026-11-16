"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtImageSourceThread } from "./aidt-image-source-thread";
import { aidtDiscoverySourceLabel, loadAidtDiscoverySources, type AidtDiscoverySource } from "../lib/aidt-discovery-evidence";
import { isAidtModuleEnabled } from "../lib/aidt-module-config";

/** Existing human materials only; this does not upload, post a message or start an agent. */
export function AidtDiscoverySourcePicker({ projectId, thread, readOnly, selected, onSelect, label }: { projectId: string; thread: string; readOnly: boolean; selected: AidtDiscoverySource | null; onSelect: (source: AidtDiscoverySource | null) => void; label: string }) {
  const session = useOptionalSession()?.session;
  const actor = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, thread]);
  const [source, setSource] = React.useState<{ actor: string; thread: string } | null>(null);
  const sourceThread = source?.actor === actor ? source.thread : thread;
  const [open, setOpen] = React.useState(false), [retry, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [page, setPage] = React.useState<{ actor: string; thread: string; cursor?: string } | null>(null);
  const cursor = page?.actor === actor && page.thread === sourceThread ? page.cursor : undefined;
  const identity = JSON.stringify([actor, sourceThread, cursor, open, retry]);
  const lifecycle = React.useRef({ identity, generation: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, generation: lifecycle.current.generation + 1 };
  const scope = JSON.stringify([identity, lifecycle.current.generation]);
  const [state, setState] = React.useState<{ scope: string; result?: Awaited<ReturnType<typeof loadAidtDiscoverySources>>; failed?: boolean } | null>(null);
  React.useEffect(() => {
    if (!open || !session?.sessionToken || !session.currentOrgId || !isAidtModuleEnabled()) return;
    let current = true; const cancellation = new AbortController();
    void loadAidtDiscoverySources({ projectId, threadId: sourceThread, sessionToken: session.sessionToken, cursor, signal: cancellation.signal }).then(result => { if (current) setState({ scope, result }); }).catch(() => { if (current) setState({ scope, failed: true }); });
    return () => { current = false; cancellation.abort(); };
  }, [scope, open, session?.sessionToken, session?.currentOrgId, projectId, sourceThread, cursor]);
  if (!isAidtModuleEnabled()) return null;
  const current = state?.scope === scope ? state : null;
  return <div className="space-y-2 rounded-lg border border-border p-3" aria-label={`${label}已发送材料`}>
    {selected?.projectId === projectId && <div className="space-y-1 text-12"><p>保存的来源定位（待核对）：{aidtDiscoverySourceLabel(selected)}</p><p className="whitespace-pre-wrap">材料原文快照{selected.truncated ? "（前4000字）" : ""}：{selected.text}</p><Button type="button" variant="ghost" size="xs" disabled={readOnly} onClick={() => { if (!readOnly) onSelect(null); }}>移除材料关联</Button></div>}
    <Button type="button" variant="outline" size="sm" disabled={readOnly || !session?.sessionToken} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "收起已发送材料" : "关联本组已发送的原文"}</Button>
    {open && <div className="space-y-2"><p className="text-11 text-muted-foreground">仅列出学生已发送的文字，不列AI回答。消息来源可追溯不代表访谈已核实；关联不会覆盖原话或学生解释。</p>
      <AidtImageSourceThread projectId={projectId} thread={sourceThread} readOnly={readOnly} label={`${label}材料来源对话`} actionLabel="选择本组材料来源对话" onChange={id => { setSource({ actor, thread: id }); setPage(null); }} />
      {!current ? <p role="status">正在核对材料来源…</p> : current.failed ? <div role="alert"><p>材料读取失败，未判定为没有原文。</p><Button type="button" size="sm" variant="outline" onClick={refresh}>重试原文材料</Button></div> : <>
        {!current.result?.items.length && <p>此页没有可关联的学生文字。原始材料不齐时保留缺口。</p>}
        {current.result?.items.map(item => <article className="space-y-1 rounded-md border border-border p-2" key={item.messageId} data-testid="aidt-discovery-source-option"><p className="whitespace-pre-wrap text-12">{item.text}</p><p className="break-all text-11 text-muted-foreground">{aidtDiscoverySourceLabel(item)}</p><Button type="button" size="xs" variant="outline" disabled={readOnly} onClick={() => { if (!readOnly) { onSelect(item); setOpen(false); } }}>关联这段学生材料</Button></article>)}
        {current.result?.nextCursor && <Button type="button" size="sm" variant="ghost" onClick={() => setPage({ actor, thread: sourceThread, cursor: current.result?.nextCursor ?? undefined })}>读取更早的材料</Button>}
        {cursor && <Button type="button" size="sm" variant="ghost" onClick={() => setPage(null)}>返回最新材料</Button>}
      </>}
    </div>}
  </div>;
}
