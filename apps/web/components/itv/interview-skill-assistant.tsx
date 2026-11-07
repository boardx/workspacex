"use client";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { MessageCircle, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewStep, DigitalInterviewWorkflowView } from "@/lib/interview-api";
import type { MockDigitalInterviewDraft, MockSkillSuggestion } from "@/lib/mock/digital-interview-drafts";

import { InterviewSkillContent, parseSkillPatch } from "./interview-skill-content";

const QUICK_PROMPTS = [{"id": "topic", "key": "itv.skill.prompt.topic"}, {"id": "experts", "key": "itv.skill.prompt.experts"}, {"id": "questions", "key": "itv.skill.prompt.questions"}, {"id": "leading", "key": "itv.skill.prompt.leading"}, {"id": "report", "key": "itv.skill.prompt.report"}] as const;
type PromptIntent = typeof QUICK_PROMPTS[number]["id"];

export function InterviewSkillAssistant({ draft, onSend, onApply, onUndo }: {
  draft: MockDigitalInterviewDraft;
  onSend: (text: string, suggestion: MockSkillSuggestion) => void;
  onApply: () => void;
  onUndo: () => void;
}) {
 const { t } = useI18n();
  const [input, setInput] = React.useState("");
  const [intent, setIntent] = React.useState<PromptIntent | null>(null);

  function send(text = input) {
    const value = text.trim();
    if (!value) return;
    onSend(value, suggestionFor(value, draft, intent));
    setInput(""); setIntent(null);
  }

  return (
    <aside data-testid="itv-skill-assistant" className="border-b border-border bg-card lg:min-h-[calc(100vh-7rem)] lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="sticky top-0 flex max-h-[calc(100vh-7rem)] flex-col p-5">
        <div className="flex items-center gap-2"><MessageCircle className="size-5 text-primary" aria-hidden /><h2 className="font-semibold">{t("itv.skill.title")}</h2></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("itv.skill.mockHint")}</p>
        <div className="mt-4 flex flex-wrap gap-2">{QUICK_PROMPTS.map((prompt) => <button key={prompt.id} type="button" onClick={() => { setInput(t(prompt.key)); setIntent(prompt.id); }} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-background-foreground">{t(prompt.key)}</button>)}</div>
        <div className="mt-5 min-h-40 flex-1 space-y-3 overflow-y-auto">
          {draft.skillMessages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-6 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground" : "mr-3 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-background-foreground"}>{message.text}</div>)}
          {draft.pendingSuggestion && <div data-testid="itv-skill-suggestion" className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5"><strong>{t("itv.skill.suggestion")}</strong><p className="mt-1">{draft.pendingSuggestion.text}</p><Button data-testid="itv-skill-apply" type="button" variant="primary" size="sm" className="mt-3" onClick={onApply} disabled={draft.pendingSuggestion.applied}>{t("itv.skill.apply")}</Button></div>}
        </div>
        {draft.undoSnapshot && <Button data-testid="itv-skill-undo" type="button" variant="outline" size="sm" className="mt-3 self-start" onClick={onUndo}><Undo2 className="size-3" aria-hidden />{t("itv.skill.undo")}</Button>}
        <div className="mt-4 flex gap-2"><input data-testid="itv-skill-input" value={input} onChange={(event) => { setInput(event.target.value); setIntent(null); }} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder={t("itv.skill.placeholder")} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" /><Button data-testid="itv-skill-send" aria-label={t("itv.send")} type="button" variant="primary" size="icon" disabled={!input.trim()} onClick={() => send()}><Send className="size-4" aria-hidden /></Button></div>
        <p className="mt-3 text-[10px] text-muted-foreground">{t("itv.skill.mockBoundary")}</p>
      </div>
    </aside>
  );
}

function suggestionFor(text: string, draft: MockDigitalInterviewDraft, intent: PromptIntent | null = null): MockSkillSuggestion {
  if (intent === "experts" || text.includes("专家")) return { target: "experts", text: "建议补充采购执行、合规审批与最终决策三个互补角色。", applied: false };
  if (intent === "questions" || intent === "leading" || text.includes("问题") || text.includes("诱导")) return { target: "questions", text: "建议把判断题改成开放式问题，并追问职责边界和一个反例。", applied: false };
  if (intent === "report" || text.includes("报告")) return { target: "report", text: "建议报告按背景、关键发现、分歧、待验证假设和素材来源组织。", applied: false };
  return { target: "topic", text: `建议主题：围绕“${draft.topic || draft.name}”明确决策角色、否决条件与可验证反例。`, applied: false };
}

export function PersistentInterviewSkillAssistant({
  view,
  currentStep,
  currentExpertIds,
  onSend,
  onApply,
  onReject,
}: {
  readonly view: DigitalInterviewWorkflowView;
  readonly currentStep: DigitalInterviewStep;
  readonly currentExpertIds?: readonly string[];
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onApply: (proposalId: string) => Promise<boolean>;
  readonly onReject: (proposalId: string) => Promise<boolean>;
}) {
 const { t } = useI18n();
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
      <div className="flex items-center gap-2"><MessageCircle className="size-5 text-primary" aria-hidden /><h2 className="font-semibold">{t("itv.skill.title")}</h2></div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("itv.skill.persistentHint")}</p>
      <div className="mt-5 min-h-40 flex-1 space-y-3 overflow-y-auto">
        {view.skillMessages.map((message) => <div key={message.messageId} className={message.role === "user" ? "ml-6 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground" : "mr-3 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-background-foreground"}>{message.role === "assistant" && parseSkillPatch(message.text)
          ? <InterviewSkillContent patch={view.skillProposals.find((proposal) => proposal.sourceMessageId === message.messageId)?.patch ?? parseSkillPatch(message.text)!} view={view} />
          : message.text}</div>)}
        {view.skillProposals.map((proposal) => <div data-testid={`itv-skill-proposal-${proposal.proposalId}`} key={proposal.proposalId} className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5">
          <strong>{t("itv.skill.suggestion")}</strong><InterviewSkillContent patch={proposal.patch} view={view}
            compareExpertIds={proposal.status === "proposed" && proposal.baseRevisionId === view.revisionId
              ? currentExpertIds ?? (view.selectedExpertIds.length ? view.selectedExpertIds : view.expertCandidates.map((expert) => expert.expertId)) : undefined} />
          {proposal.status === "proposed" && proposal.targetStep === currentStep && <div className="mt-3 flex gap-2"><Button data-testid="itv-skill-apply" type="button" variant="primary" size="sm" onClick={() => void onApply(proposal.proposalId)}>{t("itv.skill.apply")}</Button><Button data-testid="itv-skill-reject" type="button" variant="outline" size="sm" onClick={() => void onReject(proposal.proposalId)}>{t("itv.skill.reject")}</Button></div>}
          {proposal.status === "proposed" && proposal.targetStep !== currentStep && <p className="mt-2 text-muted-foreground">{t("itv.skill.switchStep")}</p>}
          {proposal.status === "applied_to_draft" && <p className="mt-2 font-medium text-primary">{t("itv.skill.appliedDraft")}</p>}
          {proposal.status === "rejected" && <p className="mt-2 text-muted-foreground">{t("itv.skill.rejected")}</p>}
          {proposal.status === "committed" && <p className="mt-2 text-muted-foreground">{t("itv.skill.committed")}</p>}
          {proposal.status === "stale" && <p className="mt-2 text-muted-foreground">{t("itv.skill.stale")}</p>}
        </div>)}
      </div>
      <div className="mt-4 flex gap-2"><input data-testid="itv-skill-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder={t("itv.skill.placeholder")} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" /><Button data-testid="itv-skill-send" aria-label={t("itv.send")} type="button" variant="primary" size="icon" disabled={!input.trim() || sending} onClick={() => void send()}><Send className="size-4" aria-hidden /></Button></div>
      <p className="mt-3 text-[10px] text-muted-foreground">{t("itv.skill.persistentBoundary")}</p>
    </div>
  </aside>;
}
