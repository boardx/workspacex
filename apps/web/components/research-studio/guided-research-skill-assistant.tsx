"use client";

import * as React from "react";
import { Loader2, MessageCircle, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runGuidedResearchSkillTurn, type GuidedResearchSkillDraft } from "@/lib/guided-research-api";
import {
  applyResearchSkillSuggestion,
  cloneResearchEditableSnapshot,
  loadResearchSkillState,
  saveResearchSkillState,
  type ResearchEditableSnapshot,
  type ResearchEditableSnapshotInput,
  type ResearchSkillState,
} from "@/lib/guided-research-skill-state";

const QUICK_PROMPTS: Record<ResearchEditableSnapshot["step"], readonly string[]> = {
  brief: ["补充研究目标", "明确决策问题"],
  directions: ["补充研究方向", "检查方向覆盖"],
  outline: ["补充报告章节", "优化报告大纲"],
  search: ["完成下一项检索任务", "检查检索进度"],
  report: ["完善报告摘要", "补充关键结论"],
};

export function GuidedResearchSkillAssistant({
  step,
  sessionKey,
  progressLabel,
  snapshot,
  onSnapshotChange,
}: {
  step: ResearchEditableSnapshot["step"];
  sessionKey: string;
  progressLabel?: string;
  snapshot: ResearchEditableSnapshot | ResearchEditableSnapshotInput;
  onSnapshotChange: (snapshot: ResearchEditableSnapshot) => void;
}) {
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState(false);
  const [skillState, setSkillState] = React.useState<ResearchSkillState>(() => loadResearchSkillState(sessionKey, step));

  React.useEffect(() => {
    setSkillState(loadResearchSkillState(sessionKey, step));
  }, [sessionKey, step]);

  function persist(next: ResearchSkillState) {
    setSkillState(next);
    saveResearchSkillState(sessionKey, next);
  }

  function apiDraft(): GuidedResearchSkillDraft {
    if (snapshot.step === "brief") return { node: "brief", value: { ...snapshot.value } };
    if (snapshot.step === "directions") return { node: "directions", value: snapshot.value.map((item) => ({ ...item })) };
    if (snapshot.step === "outline") return { node: "outline", value: snapshot.value.map((item) => ({ ...item, questions: [...item.questions] })) };
    if (snapshot.step === "search") {
      const acceptedSourceIds = Object.entries(snapshot.value.sourceDecisions).flatMap(([id, decision]) => decision === "accepted" ? [id] : []);
      const excludedSourceIds = Object.entries(snapshot.value.sourceDecisions).flatMap(([id, decision]) => decision === "excluded" ? [id] : []);
      return { node: "research", value: { acceptedSourceIds, excludedSourceIds } };
    }
    return { node: "report", value: { reportSummary: snapshot.value.reportSummary } };
  }

  async function send(text = input) {
    const prompt = text.trim();
    if (!prompt || sending) return;
    setSending(true);
    setSendError(false);
    setInput("");
    try {
      const response = await runGuidedResearchSkillTurn({
        requestId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `skill-${Date.now()}`,
        message: prompt,
        draft: apiDraft(),
      });
      const proposal = response.proposal;
      const suggestion = proposal.node === "brief"
        ? { step: "brief" as const, prompt, text: response.assistantMessage, value: proposal.value }
        : proposal.node === "directions"
          ? { step: "directions" as const, prompt, text: response.assistantMessage, value: proposal.value }
          : proposal.node === "outline"
            ? { step: "outline" as const, prompt, text: response.assistantMessage, value: proposal.value }
            : proposal.node === "research" && snapshot.step === "search"
              ? {
                step: "search" as const,
                prompt,
                text: response.assistantMessage,
                value: {
                  ...snapshot.value,
                  completedTaskIds: [...snapshot.value.completedTaskIds],
                  sourceDecisions: Object.fromEntries([
                    ...proposal.value.acceptedSourceIds.map((id) => [id, "accepted"] as const),
                    ...proposal.value.excludedSourceIds.map((id) => [id, "excluded"] as const),
                  ]),
                },
              }
              : proposal.node === "report" && snapshot.step === "report"
                ? { step: "report" as const, prompt, text: response.assistantMessage, value: proposal.value }
                : null;
      if (!suggestion) throw new Error("skill proposal targeted another step");
      const messageCount = skillState.messages.length;
      persist({
        ...skillState,
        messages: [
          ...skillState.messages,
          { id: `message-${messageCount + 1}`, role: "user", text: prompt },
          { id: `message-${messageCount + 2}`, role: "skill", text: response.assistantMessage },
        ],
        pendingSuggestion: suggestion,
      });
    } catch {
      setSendError(true);
      setInput(prompt);
    } finally {
      setSending(false);
    }
  }

  function apply() {
    if (!skillState.pendingSuggestion || skillState.pendingSuggestion.step !== step || snapshot.step !== step) return;
    const nextSnapshot = applyResearchSkillSuggestion(skillState.pendingSuggestion, snapshot);
    persist({ ...skillState, pendingSuggestion: null, undoSnapshot: cloneResearchEditableSnapshot(snapshot) });
    onSnapshotChange(nextSnapshot);
  }

  function undo() {
    if (!skillState.undoSnapshot || skillState.undoSnapshot.step !== step) return;
    onSnapshotChange(skillState.undoSnapshot);
    persist({ ...skillState, undoSnapshot: null });
  }

  return (
    <section
      data-testid="research-skill-assistant"
      data-surface="full-height-conversation"
      className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <MessageCircle aria-hidden className="size-5 text-primary" />
        <h2 className="font-semibold">研究 Skill 助手</h2>
        {progressLabel && (
          <span
            className="ml-auto rounded-full border border-border bg-muted px-2 py-0.5 text-11 font-medium text-muted-foreground"
            data-testid="research-skill-progress"
          >
            {progressLabel}
          </span>
        )}
      </div>
      <p className="mt-2 text-12 leading-5 text-muted-foreground">通过对话优化当前步骤；建议只有点击应用后才会修改内容。</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_PROMPTS[step].map((prompt) => (
          <button key={prompt} type="button" disabled={sending} onClick={() => void send(prompt)} className="rounded-full border border-border px-3 py-1 text-12 text-muted-foreground transition-colors hover:text-foreground disabled:bg-disabled disabled:text-disabled-foreground">
            {prompt}
          </button>
        ))}
      </div>
      {sendError && <p className="mt-2 text-11 text-destructive" role="alert">模型暂时不可用，内容没有被 Mock 替代。请重试。</p>}
      <div data-testid="research-skill-messages" className="mt-4 min-h-32 flex-1 space-y-3 overflow-y-auto pr-1">
        {skillState.messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "ml-6 rounded-lg bg-primary px-3 py-2 text-12 text-primary-foreground" : "mr-3 rounded-lg bg-muted px-3 py-2 text-12 leading-5 text-foreground"}>
            {message.text}
          </div>
        ))}
        {skillState.pendingSuggestion && (
          <div data-testid="research-skill-suggestion" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-12 leading-5">
            <strong>Skill 建议</strong>
            <p className="mt-1">{skillState.pendingSuggestion.text}</p>
            <Button type="button" variant="primary" size="sm" className="mt-3" onClick={apply}>应用建议</Button>
          </div>
        )}
      </div>
      {skillState.undoSnapshot && <Button type="button" variant="outline" size="sm" className="mt-3 self-start" onClick={undo}><Undo2 aria-hidden className="size-3" />撤销上次应用</Button>}
      <div data-testid="research-skill-composer" className="mt-4 flex shrink-0 gap-2">
        <input
          data-testid="research-skill-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void send(); }}
          placeholder="和 Skill 讨论如何优化…"
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <Button data-testid="research-skill-send" type="button" variant="primary" size="icon" aria-label="发送建议" disabled={!input.trim() || sending} onClick={() => void send()}>{sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}</Button>
      </div>
      <p className="mt-3 text-11 text-muted-foreground">由 qwen3.7-plus 生成建议；应用前不会修改研究内容。</p>
    </section>
  );
}
