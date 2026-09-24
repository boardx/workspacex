import type { SurveyPublishBlocker } from "@repo/contracts/survey";
import {
  isSurveyPageElement,
  type SurveyWorkflowQuestion,
} from "@repo/contracts/survey-question-types";

export type PublishReadinessAssessment = {
  qualityScore: number | null;
  estimatedSeconds: number | null;
  predictedCompletionRate: number | null;
  recommendations: Array<SurveyPublishBlocker & { label: string }>;
};

const PENALTY: Record<SurveyPublishBlocker["code"], number> = {
  QUESTIONS_EMPTY: 100,
  QUESTION_OPTIONS_EMPTY: 25,
  MAPPING_INCOMPLETE: 20,
  LEADING_QUESTION: 20,
};

const LABEL: Record<SurveyPublishBlocker["code"], string> = {
  QUESTIONS_EMPTY: "添加至少一道可回答的问题",
  QUESTION_OPTIONS_EMPTY: "为选项题补充可选择的答案",
  MAPPING_INCOMPLETE: "将题目映射到报告章节",
  LEADING_QUESTION: "改用中性的题目措辞",
};

export function assessPublishReadiness({
  questions,
  blockers,
}: {
  questions: SurveyWorkflowQuestion[];
  blockers: SurveyPublishBlocker[];
}): PublishReadinessAssessment {
  const answerable = questions.filter((question) => !isSurveyPageElement(question));
  if (answerable.length === 0) {
    return {
      qualityScore: null,
      estimatedSeconds: null,
      predictedCompletionRate: null,
      recommendations: [],
    };
  }
  const penalty = blockers.reduce((total, blocker) => total + PENALTY[blocker.code], 0);
  const qualityScore = Math.max(0, 100 - penalty);
  return {
    qualityScore,
    estimatedSeconds: answerable.reduce((total, question) => total + (question.type.startsWith("matrix_") ? 45 : question.type === "ranking" || question.type === "allocation" ? 35 : 20), 0),
    predictedCompletionRate: Math.max(0, Math.min(100, qualityScore + 20)),
    recommendations: blockers.map((blocker) => ({ ...blocker, label: LABEL[blocker.code] })),
  };
}
