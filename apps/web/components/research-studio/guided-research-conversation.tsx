"use client";
import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { GuidedResearchRuntime as Runtime } from "@/lib/guided-research-api";
import { researchStepLabels as labels } from "./guided-research-presentation";

const prompts: Record<Runtime["currentNode"], string[]> = {
  brief: ["请根据我的主题完善研究目标、时间范围、区域和重点", "确认当前主题，生成研究方向"],
  directions: ["请根据研究目标生成研究方向，并说明每个方向的重点", "确认当前研究方向，生成报告大纲"],
  outline: ["请根据研究方向完善报告大纲和每章要回答的问题", "确认当前大纲，开始资料研究"],
  research: ["请检查当前来源与研究问题的覆盖情况", "请重试失败的检索任务", "确认当前来源，生成研究报告"],
  report: ["请根据已有证据完善报告摘要与结论，保留引用", "确认当前报告，完成研究"],
};
const placeholders: Record<Runtime["currentNode"], string> = {
  brief: "例如：我想研究欧洲储能市场，重点看德国未来三年的进入机会…",
  directions: "例如：增加政策与电网接入方向，减少技术细节…",
  outline: "例如：增加国家对比章节，每章给出需要回答的问题…",
  research: "例如：检查哪些研究问题还缺少来源，或重试失败的检索…",
  report: "例如：让结论更具体，保留来源引用并说明证据缺口…",
};
const actions = { save: "应用建议", generate: "批准生成", start: "批准开始检索", retry: "批准重试", confirm: "批准确认并继续", complete: "批准完成当前步骤" };
export function GuidedResearchConversation({ node, messages, message, onMessageChange, busy, processing, onSend, proposal, proposalEdited, onApply, preview }: {
  node: Runtime["currentNode"]; messages: Runtime["messages"]; message: string; onMessageChange: (value: string) => void;
  busy: boolean; processing: boolean; onSend: (value: string) => void; proposal: Runtime["proposal"]; proposalEdited: boolean; onApply: () => void; preview: React.ReactNode;
}) {
  const end = React.useRef<HTMLDivElement>(null);
  const composing = React.useRef(false);
  React.useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [messages.length, proposal?.id, processing]);
  function send() { if (!busy && message.trim()) onSend(message); }
  return <section className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card p-5 shadow-sm" data-testid="research-skill-assistant">
    <h2 className="font-semibold">研究助手</h2>
    <p className="mt-2 text-12 text-muted-foreground">直接说出需求，助手会生成右侧内容；继续对话即可修改，确认后推进下一步。</p>
    <div className="my-4 min-h-32 flex-1 space-y-3 overflow-y-auto" data-testid="research-skill-messages">
      {!messages.length && <div className="rounded-md bg-muted p-3 text-12"><p className="font-medium">我们一起完成这项研究</p><p className="mt-2">从你的问题开始，我会帮你梳理主题、研究方向和大纲，再检索资料并生成有来源支持的报告。</p></div>}
      {messages.map((item) => <div key={item.id} className="rounded-md bg-muted p-3 text-12"><span className="font-medium">{item.role === "user" ? "你" : "研究助手"} · {labels[item.node]}</span><p className="mt-1 whitespace-pre-wrap">{item.text}</p></div>)}
      {proposal && <div className="rounded-md border border-primary p-3 text-12" data-testid="research-skill-suggestion"><p>「{labels[node]}」草稿已显示在右侧。可以继续对话修改，或应用以下建议。</p><details className="my-2"><summary className="cursor-pointer">查看建议内容</summary><div className="max-h-48 overflow-auto py-2">{preview}</div></details><Button disabled={busy || proposalEdited} onClick={onApply}>{actions[proposal.action ?? "save"]}</Button>{proposalEdited && <p className="mt-2 text-muted-foreground">右侧草稿已手动修改，继续对话将以修改后的内容为准。</p>}</div>}
      {processing && <p role="status" className="flex items-center gap-2 text-12 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />正在处理你的研究请求…</p>}
      <div ref={end} />
    </div>
    <p className="mb-2 text-12 font-medium">当前：{labels[node]}</p>
    <div className="mb-3 flex flex-wrap gap-2">{prompts[node].map((prompt) => <Button key={prompt} variant="outline" size="sm" disabled={busy} className="h-auto whitespace-normal text-left text-12" onClick={() => onMessageChange(prompt)}>{prompt}</Button>)}</div>
    <div className="flex items-end gap-2"><Textarea aria-label="研究对话" value={message} disabled={busy} onChange={(event) => onMessageChange(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }}
      data-testid="research-skill-input" placeholder={placeholders[node]} rows={3} /><Button variant="primary" disabled={busy || !message.trim()} onClick={send} aria-label="发送研究消息"><Send className="size-4" aria-hidden /></Button></div>
    <p className="mt-2 text-12 text-muted-foreground">Enter 发送 · Shift+Enter 换行</p>
  </section>;
}
