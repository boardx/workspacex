import { CheckCircle2, CircleDot, Circle, ShieldOff, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateShell, type UiState } from "@/components/state/state-shell";
import {
  RECORD_COVERAGE,
  RECORD_TRANSCRIPT,
  RECORD_COPILOT,
  type ItvView,
} from "@/lib/mock/itv";

/**
 * ③ 质性访谈现场记录（UC-6.4）—— 三栏：提纲(覆盖度) / 逐字稿 / AI 副驾驶。
 *   覆盖度是**结果度量**不是必答清单。逐字稿里：
 *   - 拒绝 AI 分析的片段（P-10）打盾牌标：只以原文引述出现，不进任何归纳（合规硬约束）。
 *   - 下属在上级发言后的附和（P-11）标「附和 · 非独立证据」，不计入强度。
 *   AI 副驾驶给追问建议/偏见提醒，但「勾选权在你」——确认后才进正式证据库。
 */
export function LiveRecord({ state, view }: { state: UiState; view: ItvView }) {
  const cp = RECORD_COPILOT;
  return (
    <section className="flex flex-col gap-3 p-5" data-testid="itv-live-record">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-20 font-semibold text-background-foreground">质性访谈现场 · 访谈 10</h1>
        <Badge tone="primary">
          <Sparkles aria-hidden className="h-3 w-3" />{cp.running}
        </Badge>
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="现场还没开始 —— 大纲确认后点「进入现场」开录"
        errors={{ transcript: "第 1 段转写失败，已保留音频，可重试转写" }}
        depFailure={{ what: "实时转录服务中断，已降级为「非实时」；音频仍在录，不伪装已同步" }}
        denial={{ layer: "project", reason: "观察者仅能看已发布脱敏结果，看不到现场逐字稿" }}
        successMessage="本段已确认并入正式证据库"
      >
        <div className="grid gap-3 xl:grid-cols-[220px_1fr_300px]">
          {/* 左：提纲 + 覆盖度 */}
          <Card className="p-3" data-testid="itv-record-coverage">
            <span className="text-12 font-medium text-background-foreground">提纲 · 覆盖度</span>
            <div className="mt-2 flex flex-col gap-1.5">
              {RECORD_COVERAGE.map((c) => (
                <div key={c.rq} className="flex items-start gap-1.5">
                  {c.state === "done" ? (
                    <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : c.state === "partial" ? (
                    <CircleDot aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <Circle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex flex-col">
                    <span className="text-11 text-background-foreground">
                      {c.rq} {c.label}
                    </span>
                    <span className="text-10 text-muted-foreground">{c.evidence}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* 中：逐字稿 */}
          <Card className="p-3" data-testid="itv-record-transcript">
            <span className="text-12 font-medium text-background-foreground">逐字稿</span>
            <div className="mt-2 flex flex-col gap-2">
              {RECORD_TRANSCRIPT.map((l, i) => (
                <div
                  key={i}
                  data-testid={`itv-transcript-line-${i}`}
                  className={cn(
                    "rounded-md border p-2",
                    l.echo ? "border-warning/30 bg-warning/5" : "border-border-subtle bg-panel",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-10 font-mono text-muted-foreground">{l.time}</span>
                    <span className="text-11 font-medium text-background-foreground">{l.speaker}</span>
                    {l.aiOptOut && (
                      <Badge tone="danger" data-testid={`itv-transcript-optout-${i}`}>
                        <ShieldOff aria-hidden className="h-3 w-3" />拒绝 AI 分析 · 仅原文引述
                      </Badge>
                    )}
                    {l.echo && (
                      <Badge tone="warning" data-testid={`itv-transcript-echo-${i}`}>
                        <AlertTriangle aria-hidden className="h-3 w-3" />附和 · 非独立证据
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-12 text-background-foreground">{l.text}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* 右：AI 副驾驶 */}
          <Card className="p-3" data-testid="itv-record-copilot">
            <span className="text-12 font-medium text-background-foreground">AI 副驾驶 · 后台的 worker</span>
            <div className="mt-2 flex flex-col gap-3">
              <div>
                <p className="text-10 uppercase tracking-wide text-muted-foreground">识别的主题</p>
                {cp.themes.map((t) => (
                  <div key={t.name} className="mt-1 flex items-center gap-1.5">
                    <span className="text-11 text-background-foreground">{t.name}</span>
                    <Badge tone="neutral">{t.quotes} 条 · {t.strength}</Badge>
                  </div>
                ))}
                <p className="mt-1 text-10 text-warning" data-testid="itv-record-echo-note">
                  {cp.echoNote}
                </p>
              </div>
              <div>
                <p className="text-10 uppercase tracking-wide text-muted-foreground">你的提问可能有偏</p>
                {cp.biasWarnings.map((b, i) => (
                  <p key={i} className="mt-1 text-10 text-muted-foreground">· {b}</p>
                ))}
              </div>
              <div>
                <p className="text-10 uppercase tracking-wide text-muted-foreground">高价值追问 · 值得进提纲</p>
                {cp.highValueFollowups.map((f, i) => (
                  <div key={i} className="mt-1 flex items-start gap-1.5">
                    <Badge tone="primary">高</Badge>
                    <span className="text-10 text-background-foreground">{f}</span>
                  </div>
                ))}
                <Button size="xs" variant="outline" className="mt-2" disabled={view !== "researcher"}>
                  把这 2 条加入提纲 v5
                </Button>
              </div>
              <p className="rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-10 text-muted-foreground">
                {cp.confirmNote}
              </p>
            </div>
          </Card>
        </div>
      </StateShell>
    </section>
  );
}
