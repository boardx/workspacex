"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import type { MessageKey } from "@/lib/i18n/messages";
import { chatShare as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { ChatShareReadError, readChatShare } from "@/lib/live-chat-share";
import { SharedChatMessages } from "./shared-chat-messages";

export function PublicChatShareScreen({ token }: { token: string }) {
  const { t } = useI18n();
  const [value, setValue] = React.useState<ReturnType<typeof C.PublicSnapshot.parse> | null>(null);
  const [error, setError] = React.useState<MessageKey | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setValue(null); setError(null);
    void readChatShare(token, controller.signal).then(result => {
      if (!controller.signal.aborted) setValue(result);
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof ChatShareReadError ? (e.kind === "missing" ? "chatShare.missing" : "chatShare.unavailable") : "chatShare.readFailed");
    });
    return () => controller.abort();
  }, [token, attempt]);
  return <main className="min-h-dvh bg-background px-4 py-6 text-background-foreground sm:px-6 sm:py-10" data-testid="public-chat-share">
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-2 border-b border-border pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-12 font-medium text-muted-foreground">{t("chatShare.brand")}</p><LanguageSwitcher /></div>
        <h1 className="break-words text-24 font-semibold">{value?.snapshot.title ?? t("chatShare.fallbackTitle")}</h1>
        <p className="text-12 text-muted-foreground">{t("chatShare.readOnly")}</p>
      </header>
      {error ? <div role="alert" className="space-y-3"><p>{t(error)}</p><Button variant="outline" onClick={() => setAttempt(a => a + 1)}>{t("chatShare.retry")}</Button></div>
        : value ? <SharedChatMessages snapshot={value.snapshot} /> : <p role="status">{t("chatShare.loading")}</p>}
      <footer className="text-12 text-muted-foreground">{t("chatShare.footer")}</footer>
    </div>
  </main>;
}
