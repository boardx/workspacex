import { CheckCircle2, CircleDashed, Circle, ShieldCheck, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  RESEARCH_QUESTIONS, COVERAGE_LABEL, AUTHORIZATION, authGrantedCount, RETENTION,
  type Coverage,
} from "@/lib/mock/interview";

/**
 * 访谈现场页 · 左栏（UC-6.4 AC1 覆盖度 + UC-6.3 AC1 授权 3/4 + UC-5.4 保留期）。
 * 纯展示，服务端安全渲染。研究问题点击跳到对应转录段（原生锚点，跨栏可用）。
 */
const COVERAGE_ICON: Record<Coverage, typeof Circle> = {
  covered: CheckCircle2, partial: CircleDashed, untouched: Circle,
};
const COVERAGE_TONE: Record<Coverage, "primary" | "warning" | "outline"> = {
  covered: "primary", partial: "warning", untouched: "outline",
};

export function InterviewOutline() {
  const { granted, total } = authGrantedCount();
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="itv-outline">
      {/* ── 研究问题覆盖度 ─────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-13 font-semibold">研究问题覆盖度</h2>
          <span className="text-10 text-muted-foreground" data-testid="itv-coverage-summary">
            {RESEARCH_QUESTIONS.filter((q) => q.coverage === "covered").length}/{RESEARCH_QUESTIONS.length} 已覆盖
          </span>
        </div>
        <p className="text-10 text-muted-foreground">
          结束时可立刻看到 5 个研究问题各自的覆盖状态（AC1）。AI 不因听到关键词就自动勾完成，需人确认。
        </p>
        <ul className="flex flex-col gap-1.5">
          {RESEARCH_QUESTIONS.map((q) => {
            const Icon = COVERAGE_ICON[q.coverage];
            const anchor = q.evidenceSegments[0];
            return (
              <li key={q.id} data-testid={`itv-rq-${q.no}`}>
                <a
                  href={anchor ? `#itv-seg-${anchor}` : undefined}
                  className="flex items-start gap-2 rounded-md border border-border-subtle bg-card p-2 transition-colors duration-200 hover:bg-muted"
                  aria-disabled={!anchor}
                >
                  <Icon
                    aria-hidden
                    className={
                      "mt-0.5 h-3.5 w-3.5 shrink-0 " +
                      (q.coverage === "covered" ? "text-success" : q.coverage === "partial" ? "text-warning" : "text-muted-foreground")
                    }
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-11 leading-snug">{q.no}. {q.text}</span>
                    <Badge tone={COVERAGE_TONE[q.coverage]}>{COVERAGE_LABEL[q.coverage]}</Badge>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <Separator />

      {/* ── 授权 3/4（同意联动）───────────────────────────── */}
      <section className="flex flex-col gap-2" data-testid="itv-auth-panel">
        <div className="flex items-center gap-1.5">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-13 font-semibold">
            授权 <span data-testid="itv-auth-count">{granted}/{total}</span>
          </h2>
        </div>
        <p className="text-10 text-muted-foreground">
          来自受访者自己那块屏的逐项勾选。未授权项在现场被禁用，而非提示后照做。
        </p>
        <ul className="flex flex-col gap-1">
          {AUTHORIZATION.items.map((it) => (
            <li
              key={it.id}
              data-testid={`itv-auth-${it.id}`}
              className="flex items-center justify-between rounded-sm bg-card px-2 py-1.5"
            >
              <span className="text-11">{it.label}</span>
              {it.granted ? (
                <Badge tone="primary">已授权</Badge>
              ) : (
                <Badge tone="outline">未授权 · 已禁用</Badge>
              )}
            </li>
          ))}
        </ul>
        <div
          className="flex flex-col gap-0.5 rounded-md border border-warning/30 bg-warning/5 p-2"
          data-testid="itv-alias-note"
        >
          <span className="text-11 font-medium">实名引用：已拒绝</span>
          <span className="text-10 text-muted-foreground">
            报告与引述里一律写「{AUTHORIZATION.alias}」，不出现真名。
          </span>
        </div>
      </section>

      <Separator />

      {/* ── 保留期（UC-5.4）──────────────────────────────── */}
      <section className="flex flex-col gap-1.5" data-testid="itv-retention">
        <div className="flex items-center gap-1.5">
          <Clock aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-13 font-semibold">转写保留期</h2>
        </div>
        <p className="text-10 text-muted-foreground">
          逐字稿保留 {RETENTION.retentionDays} 天，{RETENTION.deleteBy} 自动删除，禁止用于训练。
        </p>
      </section>
    </div>
  );
}
