import { translate, type MessageKey } from "./i18n/messages";
import type { Locale } from "./i18n/locale";

const reasonKeys: Readonly<Record<string, MessageKey>> = {
  "BRIEF_SCOPE_MISSING": "itv.quality.reason.BRIEF_SCOPE_MISSING",
  "BRIEF_TARGET_ROLE_MISSING": "itv.quality.reason.BRIEF_TARGET_ROLE_MISSING",
  "BRIEF_SUCCESS_CRITERIA_MISSING": "itv.quality.reason.BRIEF_SUCCESS_CRITERIA_MISSING",
  "EXPERT_GOAL_UNCOVERED": "itv.quality.reason.EXPERT_GOAL_UNCOVERED",
  "EXPERT_GOAL_SINGLE_PERSPECTIVE": "itv.quality.reason.EXPERT_GOAL_SINGLE_PERSPECTIVE",
  "LEADING_WORDING": "itv.quality.reason.LEADING_WORDING",
  "DOUBLE_BARRELLED": "itv.quality.reason.DOUBLE_BARRELLED",
  "YES_NO_ONLY": "itv.quality.reason.YES_NO_ONLY",
  "MISSING_EXPERIENCE_ANCHOR": "itv.quality.reason.MISSING_EXPERIENCE_ANCHOR",
  "EXPERT_MISMATCH": "itv.quality.reason.EXPERT_MISMATCH",
  "DUPLICATE_INTENT": "itv.quality.reason.DUPLICATE_INTENT",
  "MISSING_COUNTEREXAMPLE": "itv.quality.reason.MISSING_COUNTEREXAMPLE",
  "GOAL_NOT_COVERED": "itv.quality.reason.GOAL_NOT_COVERED",
  "INTERVIEW_TOO_SHORT": "itv.quality.reason.INTERVIEW_TOO_SHORT",
  "INTERVIEW_TOO_LONG": "itv.quality.reason.INTERVIEW_TOO_LONG",
  "QUESTION_GOAL_IMBALANCE": "itv.quality.reason.QUESTION_GOAL_IMBALANCE"
};

/** Translate controlled public reasons; unknown diagnostics and authored goal text remain intact. */
export function interviewQualityText(issue: { readonly code: string; readonly message: string }, locale: Locale): string {
  const key = Object.hasOwn(reasonKeys, issue.code) ? reasonKeys[issue.code] : undefined;
  if (!key || locale === "zh-CN") return issue.message;
  const needsGoal = ["EXPERT_GOAL_UNCOVERED", "EXPERT_GOAL_SINGLE_PERSPECTIVE", "GOAL_NOT_COVERED"].includes(issue.code);
  const goal = /^学习目标“([\s\S]*)”/.exec(issue.message)?.[1];
  if (needsGoal && goal === undefined) return issue.message;
  return translate(locale, key, { goal: goal ?? "" });
}
