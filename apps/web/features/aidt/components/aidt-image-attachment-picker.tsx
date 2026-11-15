"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { isAidtModuleEnabled } from "../lib/aidt-module-config";
import { aidtImageAttachmentContentUrl, loadAidtImageAttachments, type AidtImageAttachmentOption, type AidtImageAttachmentReference } from "../lib/aidt-image-attachments";

export type AidtImageAttachmentState = { src: string | null; failed: boolean };
function useAvailableImages(projectId: string, thread: string | null, enabled: boolean, retry = 0) {
  const session = useOptionalSession()?.session;
  const identity = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, thread, enabled, retry]);
  const lifecycle = React.useRef({ identity, generation: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, generation: lifecycle.current.generation + 1 };
  const scope = JSON.stringify([identity, lifecycle.current.generation]);
  const [state, setState] = React.useState<{ scope: string; items?: readonly AidtImageAttachmentOption[]; failed?: boolean } | null>(null);
  React.useEffect(() => {
    if (!enabled || !thread || !session?.sessionToken || !session.currentOrgId) return;
    let active = true; const cancellation = new AbortController();
    void loadAidtImageAttachments({ projectId, threadId: thread, sessionToken: session.sessionToken, signal: cancellation.signal }).then((items) => {
      if (active) setState({ scope, items });
    }).catch(() => { if (active) setState({ scope, failed: true }); });
    return () => { active = false; cancellation.abort(); };
  }, [scope, enabled, projectId, thread, session?.sessionToken, session?.currentOrgId]);
  return { scope, state: state?.scope === scope ? state : null };
}

function AuthorizedImage({ reference, alt, onState, onRetry }: { reference: AidtImageAttachmentReference; alt: string; onState?: (state: AidtImageAttachmentState) => void; onRetry?: () => void }) {
  const state = useAuthedImageSrc(aidtImageAttachmentContentUrl(reference));
  const imageKey = JSON.stringify([reference.threadId, reference.attachmentId, state.src]);
  const current = React.useRef({ key: imageKey, active: true }); current.current.key = imageKey;
  const [decoded, setDecoded] = React.useState<{ key: string; failed: boolean } | null>(null);
  const notify = React.useRef(onState); notify.current = onState;
  const failed = state.failed || (decoded?.key === imageKey && decoded.failed);
  const ready = !!state.src && !failed && decoded?.key === imageKey && !decoded.failed;
  React.useEffect(() => { notify.current?.({ src: ready ? state.src : null, failed }); }, [ready, state.src, failed]);
  React.useEffect(() => {
    const lifecycle = current.current; lifecycle.active = true;
    return () => { lifecycle.active = false; notify.current?.({ src: null, failed: false }); };
  }, []);
  const report = (valid: boolean) => { if (current.current.active && current.current.key === imageKey) setDecoded({ key: imageKey, failed: !valid }); };
  if (failed) return <span className="space-y-2 text-12 text-muted-foreground"><span className="block">图片读取或解码失败，请重新选择或重试。</span>{onRetry && <Button type="button" size="sm" variant="outline" onClick={onRetry}>重试图片</Button>}</span>;
  if (!state.src) return <span className="text-12 text-muted-foreground">正在读取图片…</span>;
  // eslint-disable-next-line @next/next/no-img-element -- native authenticated image hook provides a revocable blob URL
  return <img key={imageKey} src={state.src} alt={alt} className="max-h-52 w-full rounded-md object-contain" onLoad={(event) => report(event.currentTarget.naturalWidth > 0 && event.currentTarget.naturalHeight > 0)} onError={() => report(false)} />;
}

/** Also safe for restored references: validate group/thread/message before requesting bytes. */
export function AidtImageAttachmentPreview(props: { projectId: string; reference: AidtImageAttachmentReference; alt?: string; onState?: (state: AidtImageAttachmentState) => void }) {
  if (!isAidtModuleEnabled()) return null;
  return <EnabledPreview {...props} />;
}
function EnabledPreview({ projectId, reference, alt, onState }: { projectId: string; reference: AidtImageAttachmentReference; alt?: string; onState?: (state: AidtImageAttachmentState) => void }) {
  const [retry, setRetry] = React.useState(0);
  const { state, scope } = useAvailableImages(projectId, reference.threadId, true, retry);
  const selected = state?.items?.find((item) => item.attachmentId === reference.attachmentId && item.name === reference.name);
  const notify = React.useRef(onState); notify.current = onState;
  React.useEffect(() => { if (!selected) notify.current?.({ src: null, failed: !!state }); }, [scope, selected, state]);
  if (!state) return <p role="status" className="text-12 text-muted-foreground">正在核对图片来源…</p>;
  if (!selected) return <div className="space-y-2"><p role="status" className="text-12 text-muted-foreground">图片不可用或无权访问，未替换成其他图片。</p><Button type="button" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>重试图片</Button></div>;
  return <AuthorizedImage key={`${scope}:${selected.attachmentId}`} reference={selected} alt={alt ?? selected.name} onState={onState} onRetry={() => setRetry((value) => value + 1)} />;
}

function ImageChoice({ item, selected, readOnly, onSelect }: { item: AidtImageAttachmentOption; selected: boolean; readOnly: boolean; onSelect: () => void }) {
  const [ready, setReady] = React.useState(false);
  return <button type="button" disabled={readOnly || !ready} aria-pressed={selected} className="space-y-2 rounded-md border border-border bg-card p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={onSelect}><AuthorizedImage reference={item} alt={item.name} onState={(state) => setReady(!!state.src && !state.failed)} /><span className="block break-all text-12">{item.name}</span></button>;
}

type PickerProps = {
  projectId: string;
  thread: string | null;
  value?: AidtImageAttachmentReference;
  onChange: (reference: AidtImageAttachmentReference | null) => void;
  readOnly?: boolean;
  label?: string;
};
/** Chooses already-sent native Chat materials; this component has no upload/send operation. */
export function AidtImageAttachmentPicker(props: PickerProps) {
  if (!isAidtModuleEnabled()) return null;
  return <EnabledPicker {...props} />;
}
function EnabledPicker({ projectId, thread, value, onChange, readOnly = false, label = "点子图像" }: PickerProps) {
  const [open, setOpen] = React.useState(false), [retry, setRetry] = React.useState(0), [visible, setVisible] = React.useState(12);
  const { state, scope } = useAvailableImages(projectId, thread, open, retry);
  return <div className="space-y-2" data-testid="aidt-image-attachment-picker">
    <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={readOnly || !thread} aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? "收起图片" : `选择${label}`}</Button>{value && <><span className="min-w-0 break-all text-12">{value.name}</span><Button type="button" size="xs" variant="ghost" disabled={readOnly} onClick={() => onChange(null)}>移除{label}</Button></>}</div>
    {!thread && <p className="text-12 text-muted-foreground">本步对话就绪后，可选择已发送的图片附件。</p>}
    {open && thread && <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-12 text-muted-foreground">从本步共享对话中选择已发送的图片。新图片请先通过原生聊天附件发送；此处不会上传或发送消息。</p>
      {!state ? <p role="status" className="text-12">正在读取本步图片…</p> : state.failed ? <div role="alert" className="space-y-2"><p className="text-12">图片列表读取失败，不能据此判断没有图片。</p><Button type="button" size="sm" variant="outline" onClick={() => setRetry((current) => current + 1)}>重试图片列表</Button></div> : !state.items?.length ? <p role="status" className="text-12 text-muted-foreground">本步还没有可选择的已发送图片。</p> : <><Button type="button" size="sm" variant="ghost" onClick={() => setRetry((value) => value + 1)}>刷新图片</Button><div className="grid grid-cols-2 gap-2">{state.items.slice(0, visible).map((item) => <ImageChoice key={`${scope}:${item.attachmentId}`} item={item} readOnly={readOnly} selected={value?.threadId === item.threadId && value.attachmentId === item.attachmentId} onSelect={() => { onChange({ attachmentId: item.attachmentId, threadId: item.threadId, name: item.name }); setOpen(false); }} />)}</div>{state.items.length > visible && <Button type="button" size="sm" variant="ghost" onClick={() => setVisible((current) => current + 12)}>显示更多图片</Button>}</>}
    </div>}
  </div>;
}
