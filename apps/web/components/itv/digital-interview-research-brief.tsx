"use client";
import { useI18n } from "@/lib/i18n/provider";

import { Button } from "@/components/ui/button";
import type { DigitalInterviewResearchBrief } from "@/lib/interview-api";

export function DigitalInterviewResearchBriefEditor({ topic, brief, onTopicChange, onChange, onConfirm }:
  { readonly topic: string; readonly brief: DigitalInterviewResearchBrief; readonly onTopicChange: (value: string) => void;
    readonly onChange: (value: DigitalInterviewResearchBrief) => void; readonly onConfirm: () => void }) {
 const { t } = useI18n();
  const list = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return <div data-testid="itv-research-brief"><h2 className="text-xl font-semibold">{t("itv.brief.title")}</h2>
    <p className="mt-2 text-sm text-muted-foreground">{t("itv.brief.hint")}</p>
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <Field label={t("itv.brief.topic")}><textarea data-testid="itv-topic-input" value={topic} onChange={(e) => onTopicChange(e.target.value)} rows={3} /></Field>
      <Field label={t("itv.brief.decision")}><textarea data-testid="itv-brief-decision" value={brief.decision} onChange={(e) => onChange({ ...brief, decision: e.target.value })} rows={3} /></Field>
      <Field label={t("itv.brief.goals")}><textarea data-testid="itv-brief-goals" value={brief.learningGoals.map((goal) => goal.statement).join("\n")} onChange={(e) => onChange({ ...brief, learningGoals: list(e.target.value).slice(0, 5).map((statement, index) => ({ goalId: brief.learningGoals[index]?.goalId ?? `goal-${index + 1}`, statement })) })} rows={5} /></Field>
      <Field label={t("itv.brief.roles")}><textarea value={brief.targetRoles.join("\n")} onChange={(e) => onChange({ ...brief, targetRoles: list(e.target.value) })} rows={5} /></Field>
      <Field label={t("itv.brief.outOfScope")}><textarea value={brief.outOfScope.join("\n")} onChange={(e) => onChange({ ...brief, outOfScope: list(e.target.value) })} rows={4} /></Field>
      <Field label={t("itv.brief.criteria")}><textarea value={brief.successCriteria.join("\n")} onChange={(e) => onChange({ ...brief, successCriteria: list(e.target.value) })} rows={4} /></Field>
    </div><Button data-testid="itv-confirm-topic" className="mt-5" variant="primary" disabled={!topic.trim() || !brief.decision.trim() || !brief.learningGoals.length || !brief.targetRoles.length || !brief.successCriteria.length} onClick={onConfirm}>{t("itv.brief.confirm")}</Button>
  </div>;
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactElement<{ className?: string }> }) {
  return <label className="grid gap-2 text-sm font-medium">{label}{children && <span className="[&_textarea]:w-full [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:font-normal">{children}</span>}</label>;
}
