import { Link2, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SURVEY_CONCLUSIONS, SURVEY_QUESTIONS, MIN_INFERABLE_N } from "@/lib/mock/survey";

/**
 * 问卷 · 右栏：结果进证据链（UC-12.3 AC1：问卷结论能点回原始分布）。
 * 每条结论都挂题目锚点；样本量 < 8 的结论显式标「不可推断」。
 */
export function SurveyEvidence() {
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="survey-evidence">
      <div className="flex items-center gap-1.5">
        <ClipboardCheck aria-hidden className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-13 font-semibold">结果进证据链</h2>
      </div>
      <p className="text-10 text-muted-foreground">
        问卷结论进入证据链后同样要可定位——每条都能点回它所依据的原始分布。无锚点不入库。
      </p>
      <ul className="flex flex-col gap-2">
        {SURVEY_CONCLUSIONS.map((c) => {
          const q = SURVEY_QUESTIONS.find((x) => x.id === c.questionId);
          const inferable = c.sampleN >= MIN_INFERABLE_N;
          return (
            <li key={c.id} data-testid={`survey-conclusion-${c.id}`} className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2">
              <div className="flex flex-wrap items-center gap-1">
                {c.machine && <Badge tone="ai">AI 候选</Badge>}
                {c.confirmed ? <Badge tone="primary">已入库</Badge> : <Badge tone="neutral">待确认</Badge>}
                {!inferable && <Badge tone="warning">n={c.sampleN} · 不可推断</Badge>}
              </div>
              <p className="text-11 leading-snug">{c.text}</p>
              <a
                href={`#survey-q-${c.questionId}`}
                data-testid={`survey-conclusion-anchor-${c.id}`}
                className="inline-flex items-center gap-1 self-start rounded-sm px-1 py-0.5 text-10 text-primary transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Link2 aria-hidden className="h-3 w-3" />
                点回原始分布 · {q ? `Q${q.no}` : "题目"}（n={c.sampleN}）
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
