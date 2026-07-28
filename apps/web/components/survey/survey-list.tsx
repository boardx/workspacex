import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SURVEY_LIST, SURVEY_STATUS_LABEL, type SurveyStatus } from "@/lib/mock/survey";

/** 问卷 · 左栏：问卷列表（UC-12.1）。纯展示，服务端安全渲染。 */
const STATUS_TONE: Record<SurveyStatus, "primary" | "warning" | "neutral" | "outline"> = {
  collecting: "warning", analyzed: "primary", draft: "outline", delivered: "neutral",
};

export function SurveyList({ activeId = "sv-1" }: { activeId?: string }) {
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="survey-list">
      <div className="flex items-center justify-between">
        <h2 className="text-13 font-semibold">问卷</h2>
        <Button size="xs" variant="primary" data-testid="survey-new">＋ 新建问卷</Button>
      </div>
      <p className="text-10 text-muted-foreground">
        会前用问卷拿到面上的分布，会中用小问卷做快速收敛，结果自动进洞察库与图谱。
      </p>
      <ul className="flex flex-col gap-1.5">
        {SURVEY_LIST.map((s) => (
          <li key={s.id} data-testid={`survey-item-${s.id}`}>
            <button
              type="button"
              className={
                "flex w-full flex-col gap-1 rounded-md border p-2 text-left transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (s.id === activeId ? "border-primary bg-accent" : "border-border-subtle bg-card")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-12 font-medium">{s.title}</span>
                <Badge tone={STATUS_TONE[s.status]}>{SURVEY_STATUS_LABEL[s.status]}</Badge>
              </div>
              <span className="text-10 text-muted-foreground">{s.meta} · {s.version}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
