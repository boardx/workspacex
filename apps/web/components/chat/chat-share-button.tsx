"use client";
import * as React from "react";
import { Share2 } from "lucide-react";
import type { chatShare } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { createChatShare, listChatShares, previewChatShare, revokeChatShare } from "@/lib/chat-share";
import { SharedChatMessages } from "./shared-chat-messages";

function errorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "只有对话创建者可以对外分享。";
    const serialized = error.reasonCode ?? "";
    if (serialized.includes("SHARE_PREVIEW_CHANGED")) return "对话内容已更新，请重新打开分享并预览后再生成链接。";
    if (serialized.includes("SHARE_EMPTY")) return "当前没有可分享的消息。";
    if (serialized.includes("SHARE_TOO_LARGE")) return "对话或图片过大，暂时无法生成分享。";
  }
  return "操作失败，请稍后重试。";
}

export function ChatShareButton({ threadId, bearer }: { threadId: string; bearer: string }) {
  const [open, setOpen] = React.useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button variant="ghost" size="xs" onClick={() => setOpen(true)} data-testid="chat-share-open">
      <Share2 aria-hidden className="h-3.5 w-3.5" />分享
    </Button>
    {open && <ShareDialog key={threadId + bearer} threadId={threadId} bearer={bearer} />}
  </Dialog>;
}

function ShareDialog({ threadId, bearer }: { threadId: string; bearer: string }) {
  const [preview, setPreview] = React.useState<chatShare.PreviewValue | null>(null);
  const [shares, setShares] = React.useState<chatShare.ShareValue[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const currentUrl = React.useRef<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  const busy = React.useRef(false);
  React.useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    void Promise.all([
      previewChatShare(threadId, bearer, request.signal),
      listChatShares(threadId, bearer, request.signal).then(result => { if (!request.signal.aborted) setShares(result); }),
    ]).then(([result]) => {
      if (!request.signal.aborted) setPreview(result);
    }).catch(e => { if (!request.signal.aborted) setError(errorCopy(e)); });
    return () => request.abort();
  }, [threadId, bearer]);
  async function create() {
    if (!preview || busy.current) return;
    const request = controller.current;
    if (!request || request.signal.aborted) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const result = await createChatShare(threadId, bearer, preview.revision, request.signal);
      if (request.signal.aborted) return;
      setCreatedId(result.share.id);
      currentUrl.current = window.location.origin + "/share/chat/" + result.token;
      setUrl(currentUrl.current);
      setCopied(false);
      setShares(current => [result.share, ...current]);
    } catch (e) { if (!request.signal.aborted) setError(errorCopy(e)); }
    finally { if (!request.signal.aborted) { busy.current = false; setPending(false); } }
  }
  async function revoke(id: string) {
    if (busy.current) return;
    const request = controller.current;
    if (!request || request.signal.aborted) return;
    busy.current = true; setPending(true); setError(null);
    try {
      await revokeChatShare(threadId, bearer, id, request.signal);
      if (request.signal.aborted) return;
      setShares(current => current.filter(s => s.id !== id));
      if (id === createdId) { currentUrl.current = null; setUrl(null); setCreatedId(null); setCopied(false); }
    } catch (e) { if (!request.signal.aborted) setError(errorCopy(e)); }
    finally { if (!request.signal.aborted) { busy.current = false; setPending(false); } }
  }
  async function copy() {
    const link = currentUrl.current;
    const request = controller.current;
    if (!link || !request || request.signal.aborted) return;
    setCopied(false);
    try {
      await navigator.clipboard.writeText(link);
      if (!request.signal.aborted && currentUrl.current === link) setCopied(true);
    } catch {
      if (!request.signal.aborted && currentUrl.current === link) {
        setCopied(false); setError("无法自动复制，请选中下方链接手动复制。");
      }
    }
  }
  return <DialogContent className="flex max-h-[90dvh] w-full max-w-2xl flex-col" data-testid="chat-share-dialog">
    <DialogTitle>分享对话</DialogTitle>
    <DialogDescription>任何拿到链接的人都能免登录查看以下内容。分享后新增的消息不会公开，你可以随时撤销链接。</DialogDescription>
    <p className="text-12 text-muted-foreground">分享包含文字、代码与图片附件；其他附件仅显示文件名。原始转写、待复核消息和内部工具记录不公开。</p>
    {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    {url ? <div className="space-y-2 rounded-md border border-border p-3">
      <label htmlFor="chat-share-url" className="text-12 font-medium">公开分享链接</label>
      <input id="chat-share-url" data-testid="chat-share-url" readOnly value={url} onFocus={e => e.currentTarget.select()} className="w-full rounded-md border border-input bg-background p-2 text-12" />
      <Button disabled={pending} onClick={() => void copy()} size="sm" data-testid="chat-share-copy">{copied ? "已复制" : "复制链接"}</Button>
    </div> : <Button disabled={!preview || pending} onClick={() => void create()} data-testid="chat-share-create">
      {pending ? "正在生成…" : "确认内容并生成链接"}
    </Button>}
    <div className="min-h-0 overflow-y-auto rounded-md border border-border p-4" data-testid="chat-share-preview">
      {preview ? <><h2 className="mb-4 text-16 font-semibold">{preview.snapshot.title}</h2><SharedChatMessages snapshot={preview.snapshot} /></> : !error ? <p className="text-12 text-muted-foreground">正在准备分享预览…</p> : null}
    </div>
    {shares.some(s => !s.revokedAt) && <div className="max-h-32 shrink-0 overflow-y-auto space-y-2">
      <h2 className="text-12 font-medium">已生成的链接</h2>
      {shares.filter(s => !s.revokedAt).map(s => <div key={s.id} className="flex items-center justify-between gap-2 text-12">
        <span>{new Date(s.createdAt).toLocaleString("zh-CN")}</span>
        <Button size="xs" variant="outline" disabled={pending} onClick={() => void revoke(s.id)} data-testid="chat-share-revoke">撤销链接</Button>
      </div>)}
    </div>}
  </DialogContent>;
}
