"use client";
import * as React from "react";
import { chatShare as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { readChatShare } from "@/lib/live-chat-share";
import { SharedChatMessages } from "./shared-chat-messages";

export function PublicChatShareScreen({ token }: { token: string }) {
  const [value, setValue] = React.useState<ReturnType<typeof C.PublicSnapshot.parse> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setValue(null); setError(null);
    void readChatShare(token, controller.signal).then(result => {
      if (!controller.signal.aborted) setValue(result);
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败，请重试。");
    });
    return () => controller.abort();
  }, [token, attempt]);
  return <main className="min-h-dvh bg-background px-4 py-6 text-background-foreground sm:px-6 sm:py-10" data-testid="public-chat-share">
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-2 border-b border-border pb-5">
        <p className="text-12 font-medium text-muted-foreground">WorkspaceX · 对话分享</p>
        <h1 className="break-words text-24 font-semibold">{value?.snapshot.title ?? "分享的对话"}</h1>
        <p className="text-12 text-muted-foreground">只读快照 · 无需账号即可查看</p>
      </header>
      {error ? <div role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => setAttempt(a => a + 1)}>重试</Button></div>
        : value ? <SharedChatMessages snapshot={value.snapshot} /> : <p role="status">正在读取分享…</p>}
      <footer className="text-12 text-muted-foreground">本页展示分享时的对话内容，由分享者主动公开。</footer>
    </div>
  </main>;
}
