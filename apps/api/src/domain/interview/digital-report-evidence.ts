import type { z } from "zod";
import { interview } from "@repo/contracts";

type Review = z.infer<typeof interview.DigitalInterviewReportEvidenceEligibility>;
type Mode = z.infer<typeof interview.StudyEvidenceMode>;

export function deriveApprovalEligibility(input: {
  readonly mode: Mode;
  readonly findings: readonly { readonly counterEvidenceCount: number }[];
  readonly hasUnreviewedQualityFlag: boolean;
}): Review {
  if (input.mode === "simulated") return blocked(
    "blocked_missing_participant_evidence",
    "需要真实受访者证据后才能批准。",
    "添加并复核真实受访者回答",
  );
  if (input.findings.some((finding) => finding.counterEvidenceCount === 0)) return blocked(
    "blocked_missing_counterexample",
    "每条决策结论需要记录反例或明确无反例。",
    "补充反例审查",
  );
  if (input.hasUnreviewedQualityFlag) return blocked(
    "blocked_unreviewed_quality_flag",
    "存在未复核的质量标记。",
    "完成质量复核",
  );
  return { eligibility: "eligible", message: "证据规则已满足，可以提交人工批准。", action: null };
}

export function assertFindingSources(
  runs: readonly { readonly expertId: string; readonly answers: readonly { readonly questionId: string }[] }[],
  findings: readonly { readonly expertId: string; readonly questionId: string }[],
): void {
  const sources = new Set(runs.flatMap((run) => run.answers.map((answer) => `${run.expertId}:${answer.questionId}`)));
  for (const finding of findings) {
    if (!sources.has(`${finding.expertId}:${finding.questionId}`)) throw new Error("DIGITAL_REPORT_SOURCE_INVALID");
  }
}

function blocked(
  eligibility: Exclude<Review["eligibility"], "eligible">,
  message: string,
  action: string,
): Review {
  return { eligibility, message, action };
}
