"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { createDigitalInterviewDraft, type InterviewScope } from "@/lib/interview-api";

const INDEPENDENT_SCOPE: InterviewScope = { kind: "none", projectId: null, researchProjectId: null };

export function DigitalInterviewCreateModal({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { push } = useRouter();
  const [name, setName] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestAttempt = React.useRef<{ readonly fingerprint: string; readonly requestId: string } | null>(null);

  function close() {
    onOpenChange(false);
    setName("");
    setTags([]);
    setTagDraft("");
    setBusy(false);
    setError("");
    requestAttempt.current = null;
  }

  function addTag() {
    const next = tagDraft.trim();
    if (!next || tags.includes(next) || tags.length >= 5) return;
    setTags((current) => [...current, next]);
    setTagDraft("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    const pending = tagDraft.trim();
    const nextTags = pending && !tags.includes(pending) && tags.length < 5 ? [...tags, pending] : tags;
    if (!nextTags.length) return;
    const payload = { name: name.trim(), tags: nextTags, scope: INDEPENDENT_SCOPE };
    const fingerprint = JSON.stringify(payload);
    if (requestAttempt.current?.fingerprint !== fingerprint) {
      requestAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    setBusy(true);
    setError("");
    try {
      const created = await createDigitalInterviewDraft({ ...payload, requestId: requestAttempt.current.requestId });
      close();
      push(`/itv/${created.interviewId}/setup`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.reasonCode ?? cause.message : cause instanceof Error ? cause.message : "DEPENDENCY_UNAVAILABLE");
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content data-testid="itv-create-dialog" className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-7 text-card-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Dialog.Title className="text-20 font-semibold tracking-tight">新建访谈</Dialog.Title>
              <Dialog.Description className="text-12 text-muted-foreground">创建后将直接进入访谈设计流程</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭新建访谈弹窗"><X className="size-4" aria-hidden /></Button></Dialog.Close>
          </div>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="itv-create-name" className="text-13">访谈名称</Label><span className="text-11 text-muted-foreground">{name.length}/100</span></div>
              <Input id="itv-create-name" data-testid="itv-create-name" maxLength={100} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：欧洲市场进入讨论" className="h-10" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="itv-create-tag-input" className="text-13">标签</Label><span className="text-11 text-muted-foreground">{tags.length}/5</span></div>
              <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
                {tags.map((tag) => <Badge data-testid="itv-create-tag" key={tag} tone="neutral" className="gap-1 py-1">{tag}<button type="button" aria-label={`删除标签 ${tag}`} className="rounded-sm transition-colors duration-200 hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setTags((current) => current.filter((value) => value !== tag))}><X className="h-3 w-3" aria-hidden /></button></Badge>)}
                <Input id="itv-create-tag-input" data-testid="itv-create-tag-input" disabled={tags.length >= 5} value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "," || event.key === "，") { event.preventDefault(); addTag(); } }} placeholder={tags.length >= 5 ? "最多 5 个标签" : "添加标签，按回车确认"} className="h-8 min-w-40 flex-1 border-0 px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
              </div>
              <p className="text-11 text-muted-foreground">至少添加 1 个标签，最多 5 个</p>
            </div>
            <div data-testid="itv-create-scope" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-12 text-muted-foreground"><span className="font-medium text-foreground">访谈范围：</span>独立访谈</div>
            {error && <p role="alert" className="text-12 text-destructive">创建失败：{error}。当前输入已保留，可重试。</p>}
            <div className="mt-2 flex justify-end gap-3">
              <Button type="button" variant="outline" size="lg" className="min-w-24" onClick={close}>取消</Button>
              <Button data-testid="itv-create-submit" type="submit" variant="primary" size="lg" className="min-w-28" disabled={!name.trim() || !(tags.length || tagDraft.trim()) || busy}>{busy ? "创建中…" : "开始访谈"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
