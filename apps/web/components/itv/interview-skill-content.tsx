"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { interview } from "@repo/contracts";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { findMockDigitalExpert } from "@/lib/mock/digital-expert-personas";

type Patch = Record<string, unknown>;

export function parseSkillPatch(text: string): Patch | null {
  try {
    const parsed = interview.DigitalInterviewSkillPatch.safeParse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Keep machine patches in persistence, but resolve their IDs for the human reader. */
export function InterviewSkillContent({ patch, view, compareExpertIds }: {
  readonly patch: Patch;
  readonly view: DigitalInterviewWorkflowView;
  readonly compareExpertIds?: readonly string[];
}) {
 const { t } = useI18n();
  if (typeof patch.topic === "string") return <p className="mt-1">{patch.topic}</p>;
  if (Array.isArray(patch.expertIds) && patch.expertIds.every((id): id is string => typeof id === "string")) {
    const ids = [...new Set(patch.expertIds)];
    const removed = compareExpertIds?.filter((id) => !ids.includes(id)) ?? [];
    return <div className="mt-2 space-y-2"><p>{t("itv.skill.expertCount", { count: ids.length })}</p>
      {[...ids, ...removed].map((id) => {
        const expert = view.expertCandidates.find((candidate) => candidate.expertId === id) ?? findMockDigitalExpert(id);
        const change = compareExpertIds ? removed.includes(id) ? t("itv.skill.remove") : compareExpertIds.includes(id) ? t("itv.skill.keep") : t("itv.skill.add") : null;
        return <div key={id} className="rounded-lg border border-border p-2">
          {change && <span className="mr-2 text-muted-foreground">{change}</span>}
          <strong>{expert?.role ?? t("itv.skill.unavailableExpert")}</strong>
          {expert && <p className="mt-1 text-muted-foreground">{expert.bio}</p>}
        </div>;
      })}
    </div>;
  }
  if (Array.isArray(patch.questions)) return <ol className="mt-2 list-decimal space-y-2 pl-4">{patch.questions.map((value, index) => {
    if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") return null;
    return <li key={index}>{value.text}</li>;
  })}</ol>;
  if (typeof patch.instruction === "string") return <p className="mt-1">{patch.instruction}</p>;
  return <p className="mt-1">{t("itv.skill.updateDraft")}</p>;
}
