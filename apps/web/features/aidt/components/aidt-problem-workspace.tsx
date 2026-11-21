"use client";

import * as React from "react";
import { FileText, Sparkles } from "lucide-react";
import starter from "../../../../../skills/aidt-methods-candidates/1.4.1/aidt-understand/starter.json";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AidtSharedStage } from "../lib/live-aidt-stages";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import { AIDT_OUTPUTS, aidtUiStageMarkdown, type AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtProblemDirections } from "./aidt-problem-directions";
import { AidtProblemReflection } from "./aidt-problem-reflection";

export function AidtProblemWorkspace({ draft, previousConfirmed, confirmRevision, manualEdit, update, readOnly, ask, conversationRef }: {
  draft: AidtUiStageDraft;
  previousConfirmed?: AidtSharedStage;
  confirmRevision?: number;
  manualEdit: boolean;
  update: (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean;
  ask: (text: string) => ComposerOfferResult;
  conversationRef: (element: HTMLDivElement | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [copyFeedback, setCopyFeedback] = React.useState("");
  const fields = AIDT_OUTPUTS[1]!.fields;
  const input = (id: string, label?: string, placeholder?: string) => {
    const field = fields.find(item => item.id === id)!;
    return <label key={id} className="block text-13 font-medium">
      {label ?? field.label}
      <Textarea className="mt-2 font-normal" rows={2} maxLength={6000} data-testid={`aidt-field-${id}`}
        value={draft.fields[id] ?? ""} placeholder={placeholder ?? field.placeholder} readOnly={readOnly}
        onChange={event => {
          const value = event.currentTarget.value;
          if (!readOnly) update(old => ({ ...old, fields: { ...old.fields, [id]: value, ...(id === "initial" ? { problemReflectionConfirmed: "", initialChatMessageId: "" } : {}) } }));
        }} />
    </label>;
  };
  const hasInitial = Boolean(draft.fields.initial?.trim());
  const showDetails = Object.values(draft.fields).some(value => value.trim());
  const requestFollowup = () => {
    const result = ask(`${starter.followupRequest}\n\n${aidtUiStageMarkdown(1, draft)}`);
    setFeedback(result === "accepted" ? "已填入对话输入框。检查内容后发送。"
      : result === "occupied" ? "对话中已有草稿。原草稿未覆盖。处理完后可再次带入。"
        : "对话正在准备。稍后可重试，当前问题仍保留在这里。");
  };
  const showEditor = (manualEdit || showDetails) && (!confirmRevision || editing);
  return <section className="space-y-4" aria-label="工作坊问题草稿" data-testid="aidt-stage-output">
    <div className="space-y-1">
      <h2 className="flex items-center gap-2 text-16 font-semibold tracking-tight"><FileText aria-hidden className="h-4 w-4" />工作坊主题命题</h2>
      {confirmRevision && <p className="text-12 font-medium text-accent-foreground">方向已确认 · V{confirmRevision}</p>}
      {!hasInitial && <p role="status" className="text-12 text-muted-foreground">尚未记录原始命题</p>}
    </div>
    {confirmRevision && !editing && <div className="space-y-3">
      <p className="rounded-container border border-border-subtle bg-muted p-3 text-13 font-medium">{draft.fields.rewrittenTheme}</p>
      <dl className="space-y-2 text-12"><div><dt className="font-medium">原始命题</dt><dd className="break-words">{draft.fields.initial}</dd></div>
        <div><dt className="font-medium">问题反思记录</dt><dd className="break-words">{draft.fields.whyWorthStudying}</dd></div>
        {draft.fields.sourceUncertainty && <div><dt className="font-medium">待核实</dt><dd className="break-words">{draft.fields.sourceUncertainty}</dd></div>}
      </dl>
      {!readOnly && <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>修订问题</Button>}
    </div>}
    <div ref={conversationRef} />
    {!showEditor && !confirmRevision && <div className="rounded-container border border-border-subtle px-3 py-2 text-12 text-muted-foreground">
      <dl className="divide-y divide-border-subtle">
        {["原始命题", "暂定用户", "场景", "活动或体验"].map(label => <div key={label} className="flex items-center justify-between py-2"><dt>{label}</dt><dd>—</dd></div>)}
      </dl>
      <p className="pt-2">发送第一条消息后，可在这里引用原文。</p>
    </div>}
    {showEditor && <>
    {input("initial", "初始问题")}
    {(showDetails || readOnly) && <>
      <details open className="space-y-3">
        <summary className="cursor-pointer text-13 font-semibold">问题反思记录</summary>
        <AidtProblemReflection draft={draft} onChange={next => update(old => ({ ...old, fields: next.fields }))} readOnly={readOnly} />
      </details>
      <details className="text-13" data-testid="aidt-more-fields">
        <summary className="cursor-pointer rounded-control font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">人群、场景与小组讨论</summary>
        <div className="mt-3 grid gap-3">{fields.filter(field => !["initial", "rewrittenTheme"].includes(field.id)).map(field => input(field.id))}</div>
      </details>
      <AidtProblemDirections fields={draft.fields} readOnly={readOnly} onChange={fields =>
        update(old => ({ ...old, fields: { ...old.fields, ...fields } }))
      } />
    </>}
    <div className="space-y-2 rounded-container bg-ai-tint p-3 text-ai-tint-foreground">
      <h3 className="text-13 font-semibold">和 AI 引导师一起厘清问题</h3>
      {!readOnly && <Button type="button" variant="outline" size="sm" disabled={!hasInitial} onClick={requestFollowup}>
        <Sparkles aria-hidden className="h-4 w-4" />用 AI 追问
      </Button>}
      <p role="status" className="text-12 empty:hidden">{feedback}</p>
    </div>
    {previousConfirmed && <div className="space-y-1 rounded-container bg-muted p-3 text-13" data-testid="aidt-last-confirmed-problem">
      <p className="font-medium">上次确认的问题 · V{previousConfirmed.revision}</p>
      <p className="whitespace-pre-wrap break-words">{previousConfirmed.content.draft.fields.rewrittenTheme}</p>
    </div>}
    {input("rewrittenTheme", "拟确认的工作坊问题", "用一句话写下你们准备带去访谈的问题。")}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={!showDetails} onClick={async () => {
        try {
          await navigator.clipboard.writeText(aidtUiStageMarkdown(1, draft));
          setCopyFeedback("已复制问题与依据。");
        } catch {
          setCopyFeedback("无法复制，请选中要复制的文本。");
        }
      }}>复制问题记录</Button>
      <p role="status" className="text-12 text-muted-foreground empty:hidden">{copyFeedback}</p>
    </div>
    </>}
  </section>;
}

export function AidtProblemConversation({ messages, loading, running, hasInitial, onUseInitial }: {
  messages: readonly { id: string; role: string; content?: unknown }[];
  loading: boolean;
  running: boolean;
  hasInitial: boolean;
  onUseInitial: (content: string, messageId: string) => void;
}) {
  const turns = messages.filter(message => (message.role === "assistant" || message.role === "user") && typeof message.content === "string" && message.content.trim());
  const initial = turns.find(message => message.role === "user" && String(message.content).trim() !== starter.draftTemplate);
  return <>
  {!hasInitial && initial && String(initial.content).length <= 6000 && <div className="space-y-2 rounded-container border border-border-subtle p-3">
    <p className="text-12 font-medium">来自对话的首条回答</p>
    <p className="whitespace-pre-wrap break-words text-13">{String(initial.content)}</p>
    <Button type="button" variant="outline" size="sm" onClick={() => onUseInitial(String(initial.content), initial.id)}>用作初始问题</Button>
  </div>}
  <details className="text-13" data-testid="aidt-problem-conversation">
    <summary className="cursor-pointer font-medium">
      本步对话记录{turns.length > 0 && <span className="ml-2 text-12 font-normal text-muted-foreground">{turns.length} 条</span>}
    </summary>
    <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
      {!turns.length && <p className="text-12 text-muted-foreground">{loading ? "正在读取对话…" : running ? "AI 正在准备追问…" : "发送第一条消息后，可在这里回顾问题与 AI 追问。"}</p>}
      {turns.map(turn => <article key={turn.id} className={`rounded-container p-3 ${turn.role === "assistant" ? "bg-ai-tint text-ai-tint-foreground" : "bg-muted"}`}>
        <p className="mb-1 text-12 font-semibold">{turn.role === "assistant" ? "AI 引导师" : "小组成员"}</p>
        <p className="whitespace-pre-wrap break-words text-13">{String(turn.content)}</p>
      </article>)}
    </div>
  </details>
  </>;
}
