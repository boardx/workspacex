"use client";

import * as React from "react";
import { MessageCircle, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewStep, DigitalInterviewWorkflowView } from "@/lib/interview-api";
import type { MockDigitalInterviewDraft, MockSkillSuggestion } from "@/lib/mock/digital-interview-drafts";

const QUICK_PROMPTS = ["优化访谈主题", "推荐专家", "补充针对性问题", "检查诱导性", "优化报告结构"];

export function InterviewSkillAssistant({ draft, onSend, onApply, onUndo }: {
  draft: MockDigitalInterviewDraft;
  onSend: (text: string, suggestion: MockSkillSuggestion) => void;
  onApply: () => void;
  onUndo: () => void;
}) {
  const [input, setInput] = React.useState("");

  function send(text = input) {
    const value = text.trim();
    if (!value) return;
    onSend(value, suggestionFor(value, draft));
    setInput("");
  }

  return (
    <aside data-testid="itv-skill-assistant" className="border-b border-border bg-card lg:min-h-[calc(100vh-7rem)] lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="sticky top-0 flex max-h-[calc(100vh-7rem)] flex-col p-5">
        <div className="flex items-center gap-2"><MessageCircle className="size-5 text-primary" aria-hidden /><h2 className="font-semibold">访谈 Skill 助手</h2></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">通过对话优化当前步骤。建议只有点击应用后才会修改内容。</p>
        <div className="mt-4 flex flex-wrap gap-2">{QUICK_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => send(prompt)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">{prompt}</button>)}</div>
        <div className="mt-5 min-h-40 flex-1 space-y-3 overflow-y-auto">
          {draft.skillMessages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-6 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground" : "mr-3 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-foreground"}>{message.text}</div>)}
          {draft.pendingSuggestion && <div data-testid="itv-skill-suggestion" className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5"><strong>Skill 建议</strong><p className="mt-1">{draft.pendingSuggestion.text}</p><Button data-testid="itv-skill-apply" type="button" variant="primary" size="sm" className="mt-3" onClick={onApply} disabled={draft.pendingSuggestion.applied}>应用建议</Button></div>}
        </div>
        {draft.undoSnapshot && <Button data-testid="itv-skill-undo" type="button" variant="outline" size="sm" className="mt-3 self-start" onClick={onUndo}><Undo2 className="size-3" aria-hidden />撤销上次应用</Button>}
        <div className="mt-4 flex gap-2"><input data-testid="itv-skill-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="和 Skill 讨论怎么优化…" className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" /><Button data-testid="itv-skill-send" type="button" variant="primary" size="icon" disabled={!input.trim()} onClick={() => send()}><Send className="size-4" aria-hidden /></Button></div>
        <p className="mt-3 text-[10px] text-muted-foreground">Mock Skill · 不作为真实访谈证据</p>
      </div>
    </aside>
  );
}

function suggestionFor(text: string, draft: MockDigitalInterviewDraft): MockSkillSuggestion {
  if (text.includes("专家")) return { target: "experts", text: "建议补充采购执行、合规审批与最终决策三个互补角色。", applied: false };
  if (text.includes("问题") || text.includes("诱导")) return { target: "questions", text: "建议把判断题改成开放式问题，并追问职责边界和一个反例。", applied: false };
  if (text.includes("报告")) return { target: "report", text: "建议报告按背景、关键发现、分歧、待验证假设和素材来源组织。", applied: false };
  return { target: "topic", text: `建议主题：围绕“${draft.topic || draft.name}”明确决策角色、否决条件与可验证反例。`, applied: false };
}

export function PersistentInterviewSkillAssistant({
  view,
  currentStep,
  onSend,
  onApply,
  onReject,
}: {
  readonly view: DigitalInterviewWorkflowView;
  readonly currentStep: DigitalInterviewStep;
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onApply: (proposalId: string) => Promise<boolean>;
  readonly onReject: (proposalId: string) => Promise<boolean>;
}) {
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);

  async function send(text = input) {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      if (await onSend(value)) setInput("");
    } finally {
      setSending(false);
    }
  }

  return <aside data-testid="itv-skill-assistant" className="border-b border-border bg-card lg:min-h-[calc(100vh-7rem)] lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
    <div className="sticky top-0 flex max-h-[calc(100vh-7rem)] flex-col p-5">
      <div className="flex items-center gap-2"><MessageCircle className="size-5 text-primary" aria-hidden /><h2 className="font-semibold">访谈 Skill 助手</h2></div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">消息与建议即时保存；应用建议仍需在当前步骤明确确认。</p>
      <div className="mt-5 min-h-40 flex-1 space-y-3 overflow-y-auto">
        {view.skillMessages.map((message) => <div key={message.messageId} className={message.role === "user" ? "ml-6 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground" : "mr-3 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-foreground"}>{message.text}</div>)}
        {view.skillProposals.map((proposal) => <div data-testid={`itv-skill-proposal-${proposal.proposalId}`} key={proposal.proposalId} className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5">
          <strong>Skill 建议</strong><p className="mt-1">{proposalText(proposal.patch)}</p>
          {proposal.status === "proposed" && proposal.targetStep === currentStep && <div className="mt-3 flex gap-2"><Button data-testid="itv-skill-apply" type="button" variant="primary" size="sm" onClick={() => void onApply(proposal.proposalId)}>应用建议</Button><Button data-testid="itv-skill-reject" type="button" variant="outline" size="sm" onClick={() => void onReject(proposal.proposalId)}>拒绝</Button></div>}
          {proposal.status === "proposed" && proposal.targetStep !== currentStep && <p className="mt-2 text-muted-foreground">切换到对应步骤后可应用或拒绝。</p>}
          {proposal.status === "applied_to_draft" && <p className="mt-2 font-medium text-primary">已应用到本地草稿，待确认。</p>}
          {proposal.status === "rejected" && <p className="mt-2 text-muted-foreground">已拒绝</p>}
          {proposal.status === "committed" && <p className="mt-2 text-muted-foreground">已随步骤确认提交</p>}
          {proposal.status === "stale" && <p className="mt-2 text-muted-foreground">建议已失效</p>}
        </div>)}
      </div>
      <div className="mt-4 flex gap-2"><input data-testid="itv-skill-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder="和 Skill 讨论怎么优化…" className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" /><Button data-testid="itv-skill-send" type="button" variant="primary" size="icon" disabled={!input.trim() || sending} onClick={() => void send()}><Send className="size-4" aria-hidden /></Button></div>
      <p className="mt-3 text-[10px] text-muted-foreground">持久 Skill 线程 · 建议不会自动确认业务数据</p>
    </div>
  </aside>;
}

function proposalText(patch: Record<string, unknown>): string {
  if (typeof patch.topic === "string") return patch.topic;
  if (Array.isArray(patch.expertIds)) return "建议调整访谈专家。";
  if (Array.isArray(patch.questions)) return "建议调整针对性问题。";
  return "建议更新当前步骤草稿。";
}
