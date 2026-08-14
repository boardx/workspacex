"use client";

import * as React from "react";
import { MessageCircle, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyResearchSkillSuggestion,
  cloneResearchEditableSnapshot,
  loadResearchSkillState,
  saveResearchSkillState,
  suggestionForResearchPrompt,
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
  snapshot,
  onSnapshotChange,
}: {
  step: ResearchEditableSnapshot["step"];
  sessionKey: string;
  snapshot: ResearchEditableSnapshot | ResearchEditableSnapshotInput;
  onSnapshotChange: (snapshot: ResearchEditableSnapshot) => void;
}) {
  const [input, setInput] = React.useState("");
  const [skillState, setSkillState] = React.useState<ResearchSkillState>(() => loadResearchSkillState(sessionKey, step));

  React.useEffect(() => {
    setSkillState(loadResearchSkillState(sessionKey, step));
  }, [sessionKey, step]);

  function persist(next: ResearchSkillState) {
    setSkillState(next);
    saveResearchSkillState(sessionKey, next);
  }

  function send(text = input) {
    const prompt = text.trim();
    if (!prompt) return;
    const suggestion = suggestionForResearchPrompt(prompt, snapshot);
    const messageCount = skillState.messages.length;
    persist({
      ...skillState,
      messages: [
        ...skillState.messages,
        { id: `message-${messageCount + 1}`, role: "user", text: prompt },
        { id: `message-${messageCount + 2}`, role: "skill", text: suggestion.text },
      ],
      pendingSuggestion: suggestion,
    });
    setInput("");
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
    <section data-testid="research-skill-assistant" className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <MessageCircle aria-hidden className="size-5 text-primary" />
        <h2 className="font-semibold">研究 Skill 助手</h2>
      </div>
      <p className="mt-2 text-12 leading-5 text-muted-foreground">通过对话优化当前步骤；建议只有点击应用后才会修改内容。</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_PROMPTS[step].map((prompt) => (
          <button key={prompt} type="button" onClick={() => send(prompt)} className="rounded-full border border-border px-3 py-1 text-12 text-muted-foreground transition-colors hover:text-foreground">
            {prompt}
          </button>
        ))}
      </div>
      <div className="mt-4 min-h-32 flex-1 space-y-3 overflow-y-auto">
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
      <div className="mt-4 flex gap-2">
        <input
          data-testid="research-skill-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") send(); }}
          placeholder="和 Skill 讨论如何优化…"
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <Button data-testid="research-skill-send" type="button" variant="primary" size="icon" aria-label="发送建议" disabled={!input.trim()} onClick={() => send()}><Send aria-hidden className="size-4" /></Button>
      </div>
      <p className="mt-3 text-11 text-muted-foreground">演示 Skill · 不作为真实研究证据</p>
    </section>
  );
}
