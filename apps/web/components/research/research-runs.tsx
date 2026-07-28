import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RESEARCH_RUNS, RUN_STATUS_LABEL, type RunStatus } from "@/lib/mock/research";

/** 研究 · 左栏：研究列表，每次研究读了多少 / 丢了多少一眼可见。纯展示。 */
const STATUS_TONE: Record<RunStatus, "primary" | "warning" | "neutral"> = {
  ready: "primary", building: "warning", delivered: "neutral",
};

export function ResearchRuns() {
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="research-runs">
      <div className="flex items-center justify-between">
        <h2 className="text-13 font-semibold">研究</h2>
        <Button size="xs" variant="primary" data-testid="research-new">＋ 新建研究</Button>
      </div>
      <p className="text-10 text-muted-foreground">
        一次研究 = 一个上下文包。列表直接标出这次读了多少、丢了多少。
      </p>
      <ul className="flex flex-col gap-1.5">
        {RESEARCH_RUNS.map((r) => (
          <li key={r.id} data-testid={`research-run-${r.id}`}>
            <button
              type="button"
              className={
                "flex w-full flex-col gap-1 rounded-md border p-2 text-left transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (r.active ? "border-primary bg-accent" : "border-border-subtle bg-card")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-12 font-medium">{r.title}</span>
                <Badge tone={STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
              </div>
              <div className="flex items-center gap-2 text-10 text-muted-foreground">
                <span>读入 {r.read}</span>
                <span className="text-warning">丢弃 {r.dropped}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
