"use client";

import { Button } from "@/components/ui/button";
import type { DigitalInterviewResearchBrief } from "@/lib/interview-api";

export function DigitalInterviewResearchBriefEditor({ topic, brief, onTopicChange, onChange, onConfirm }:
  { readonly topic: string; readonly brief: DigitalInterviewResearchBrief; readonly onTopicChange: (value: string) => void;
    readonly onChange: (value: DigitalInterviewResearchBrief) => void; readonly onConfirm: () => void }) {
  const list = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return <div data-testid="itv-research-brief"><h2 className="text-xl font-semibold">定义研究简报</h2>
    <p className="mt-2 text-sm text-muted-foreground">先说明这项研究要支持的决策，再定义学习目标、对象边界和成功标准。</p>
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <Field label="访谈主题"><textarea data-testid="itv-topic-input" value={topic} onChange={(e) => onTopicChange(e.target.value)} rows={3} /></Field>
      <Field label="要支持的决策"><textarea data-testid="itv-brief-decision" value={brief.decision} onChange={(e) => onChange({ ...brief, decision: e.target.value })} rows={3} /></Field>
      <Field label="学习目标（每行一项）"><textarea data-testid="itv-brief-goals" value={brief.learningGoals.map((goal) => goal.statement).join("\n")} onChange={(e) => onChange({ ...brief, learningGoals: list(e.target.value).slice(0, 5).map((statement, index) => ({ goalId: brief.learningGoals[index]?.goalId ?? `goal-${index + 1}`, statement })) })} rows={5} /></Field>
      <Field label="目标角色（每行一项）"><textarea value={brief.targetRoles.join("\n")} onChange={(e) => onChange({ ...brief, targetRoles: list(e.target.value) })} rows={5} /></Field>
      <Field label="不在范围内（每行一项）"><textarea value={brief.outOfScope.join("\n")} onChange={(e) => onChange({ ...brief, outOfScope: list(e.target.value) })} rows={4} /></Field>
      <Field label="成功标准（每行一项）"><textarea value={brief.successCriteria.join("\n")} onChange={(e) => onChange({ ...brief, successCriteria: list(e.target.value) })} rows={4} /></Field>
    </div><Button data-testid="itv-confirm-topic" className="mt-5" variant="primary" disabled={!topic.trim() || !brief.decision.trim() || !brief.learningGoals.length || !brief.targetRoles.length || !brief.successCriteria.length} onClick={onConfirm}>确认研究简报并选择专家</Button>
  </div>;
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactElement<{ className?: string }> }) {
  return <label className="grid gap-2 text-sm font-medium">{label}{children && <span className="[&_textarea]:w-full [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:font-normal">{children}</span>}</label>;
}
