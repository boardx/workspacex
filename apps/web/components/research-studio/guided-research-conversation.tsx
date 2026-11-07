"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { GuidedResearchRuntime as Runtime } from "@/lib/guided-research-api";
import type { MessageKey } from "@/lib/i18n/messages";

const prompts: Record<Runtime["currentNode"], MessageKey[]> = {
  brief: ["research.prompt.brief.0", "research.prompt.brief.1"],
  directions: ["research.prompt.directions.0", "research.prompt.directions.1"],
  outline: ["research.prompt.outline.0", "research.prompt.outline.1"],
  research: ["research.prompt.research.0", "research.prompt.research.1", "research.prompt.research.2"],
  report: ["research.prompt.report.0", "research.prompt.report.1"],
};
const placeholders: Record<Runtime["currentNode"], MessageKey> = {
  brief: "research.conversation.placeholder.brief",
  directions: "research.conversation.placeholder.directions",
  outline: "research.conversation.placeholder.outline",
  research: "research.conversation.placeholder.research",
  report: "research.conversation.placeholder.report",
};
const actions: Record<string, MessageKey> = {
  save: "research.assistant.apply",
  generate: "research.conversation.action.generate",
  start: "research.conversation.action.start",
  retry: "research.conversation.action.retry",
  confirm: "research.conversation.action.confirm",
  complete: "research.conversation.action.complete",
};

export function GuidedResearchConversation({ node, messages, message, onMessageChange, busy, processing, onSend, proposal, proposalEdited, onApply, preview, embedded = false }: {
  embedded?: boolean;
  node: Runtime["currentNode"]; messages: Runtime["messages"]; message: string; onMessageChange: (value: string) => void;
  busy: boolean; processing: boolean; onSend: (value: string) => void; proposal: Runtime["proposal"]; proposalEdited: boolean; onApply: () => void; preview: React.ReactNode;
}) {
  const { t } = useI18n();
  const end = React.useRef<HTMLDivElement>(null);
  const composing = React.useRef(false);
  React.useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [messages.length, proposal?.id, processing]);
  function send() { if (!busy && message.trim()) onSend(message); }
  return <section className={embedded ? "flex h-full min-h-0 flex-col" : "flex h-full min-h-0 flex-col rounded-xl border border-border bg-card p-5 shadow-sm"} data-testid="research-skill-assistant">
    {!embedded && <h2 className="font-semibold">{t("research.assistant.name")}</h2>}
    <p className="mt-2 text-12 text-muted-foreground">{t("research.conversation.hint")}</p>
    <div className="my-4 min-h-32 flex-1 space-y-3 overflow-y-auto" data-testid="research-skill-messages">
      {!messages.length && <div className="rounded-md bg-muted p-3 text-12"><p className="font-medium">{t("research.conversation.welcome")}</p><p className="mt-2">{t("research.conversation.welcomeDescription")}</p></div>}
      {messages.map((item) => <div key={item.id} className="rounded-md bg-muted p-3 text-12"><span className="font-medium">{t(item.role === "user" ? "research.conversation.you" : "research.assistant.name")} · {t(`research.node.${item.node}`)}</span><p className="mt-1 whitespace-pre-wrap">{item.text}</p></div>)}
      {proposal && <div className="rounded-md border border-primary p-3 text-12" data-testid="research-skill-suggestion"><p>{t("research.conversation.proposal", { label: t(`research.node.${node}`) })}</p><details className="my-2"><summary className="cursor-pointer">{t("research.conversation.viewSuggestion")}</summary><div className="max-h-48 overflow-auto py-2">{preview}</div></details><Button disabled={busy || proposalEdited} onClick={onApply}>{t(actions[proposal.action ?? "save"]!)}</Button>{proposalEdited && <p className="mt-2 text-muted-foreground">{t("research.conversation.edited")}</p>}</div>}
      {processing && <p role="status" className="flex items-center gap-2 text-12 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{t("research.conversation.processing")}</p>}
      <div ref={end} />
    </div>
    <p className="mb-2 text-12 font-medium">{t("research.conversation.current", { label: t(`research.node.${node}`) })}</p>
    <div className="mb-3 flex flex-wrap gap-2">{prompts[node].map((prompt) => <Button key={prompt} variant="outline" size="sm" disabled={busy} className="h-auto whitespace-normal text-left text-12" onClick={() => onMessageChange(t(prompt))}>{t(prompt)}</Button>)}</div>
    <div className="flex items-end gap-2"><Textarea aria-label={t("research.conversation.label")} value={message} disabled={busy} onChange={(event) => onMessageChange(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }}
      data-testid="research-skill-input" placeholder={t(placeholders[node])} rows={3} /><Button variant="primary" disabled={busy || !message.trim()} onClick={send} aria-label={t("research.conversation.send")}><Send className="size-4" aria-hidden /></Button></div>
    <p className="mt-2 text-12 text-muted-foreground">{t("research.conversation.keyboard")}</p>
  </section>;
}
