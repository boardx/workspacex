import { Bot, User, ShieldOff, FileText, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateShell, type UiState } from "@/components/state/state-shell";
import {
  MATRIX_COLUMNS,
  MATRIX_ROWS,
  MATRIX_HEADER,
  MATRIX_WRITING_GUARDS,
  EVIDENCE_LABEL,
  EVIDENCE_GLYPH,
  strongIndependentCount,
  INSIGHT_CANDIDATES,
  INSIGHT_SOURCE_MIX,
  INSIGHT_REPORT_EXPORTS,
  reportTemplateById,
  type Evidence,
  type ItvView,
} from "@/lib/mock/itv";

/** 五取值的视觉编码：色 + 形双通道（含色盲）。附和/反例不得长得像弱（UI sign-off 重点）。 */
const CELL_CLASS: Record<Evidence, string> = {
  strong: "bg-success/15 text-success border-success/40",
  weak: "bg-muted text-muted-foreground border-border",
  none: "bg-transparent text-muted-foreground border-border-subtle",
  echo: "bg-warning/10 text-warning border-dashed border-warning/50",
  counter: "bg-destructive/10 text-destructive border-destructive/50",
};

/**
 * ④⑤ 洞察与报告（UC-6.5）—— 链路的终点。
 *   证据矩阵（五取值：强/弱/未提及/附和/反例）→ 套**报告模板**出**洞察报告**。
 *   - 附和不计入强度；唯一反例必须保留；场次数 ≠ 人数；虚拟列强标记、单独计数。
 *   - 写作约束：独立受访者 < 5 时不能写「用户普遍认为」（O-16）。
 *   - 只有真人来源能标「强」——虚拟来源单独计数（任务硬约束的界面投影）。
 *   报告区**按绑定的报告模板逐章生成**（每条结论挂证据），这就是「访谈结束后出洞察报告」。
 */
export function InsightReport({ state, view }: { state: UiState; view: ItvView }) {
  const rt = reportTemplateById("rt-procure")!;
  const canWrite = view === "researcher";
  return (
    <section className="flex flex-col gap-4 p-5" data-testid="itv-insight-report">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold text-foreground">洞察与报告</h1>
        <p className="text-12 text-muted-foreground">
          子标签：单场复盘 ｜ 主题与证据矩阵 {MATRIX_HEADER.sessions} ｜ 研究报告 草稿（当前：矩阵 + 报告）
        </p>
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="还没有引述可归纳 —— 先完成至少一场访谈的逐字稿确认"
        errors={{ universal: "「测算不可信」只有 2 位独立强证据（<5），不能写「用户普遍认为」，请改「部分受访者提到」" }}
        depFailure={{ what: "归纳服务失败；已抽引述保留，不产出半截洞察，可重试" }}
        denial={{ layer: "project", reason: "观察者只能看已发布的脱敏聚合，看不到原始引述与候选洞察" }}
        successMessage="洞察已入库（固化来源快照，可点回原始证据）"
      >
        <div className="flex flex-col gap-4">
          {/* 证据矩阵 */}
          <Card className="p-4" data-testid="itv-matrix">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-13 font-medium text-foreground">
                主题与证据矩阵 · {MATRIX_HEADER.sessions} 场 · {MATRIX_HEADER.respondents} 位受访者
              </span>
              <div className="flex items-center gap-1.5">
                <Badge tone="neutral" data-testid="itv-matrix-count">场次数 ≠ 人数</Badge>
                <Badge tone="ai" data-testid="itv-matrix-virtual-count">
                  <Bot aria-hidden className="h-3 w-3" />虚拟 {MATRIX_HEADER.virtualCount} · 单独计数
                </Badge>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {MATRIX_HEADER.actions.map((a) => (
                <Button key={a} size="xs" variant="ghost" disabled={!canWrite}>{a}</Button>
              ))}
            </div>

            {/* 图例 */}
            <div className="mt-3 flex flex-wrap gap-2" data-testid="itv-matrix-legend">
              {(Object.keys(EVIDENCE_LABEL) as Evidence[]).map((e) => (
                <span
                  key={e}
                  className={cn("flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-10", CELL_CLASS[e])}
                >
                  <span className="font-mono">{EVIDENCE_GLYPH[e]}</span>
                  {EVIDENCE_LABEL[e]}
                </span>
              ))}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-11">
                <thead>
                  <tr>
                    <th className="p-1.5 text-left text-10 font-medium text-muted-foreground">主题 · {MATRIX_ROWS.length}</th>
                    {MATRIX_COLUMNS.map((c) => (
                      <th key={c.id} className="p-1.5 text-center" data-testid={`itv-matrix-col-${c.id}`}>
                        <span className="flex flex-col items-center gap-0.5">
                          <span className={cn("font-mono text-10", c.kind === "virtual" ? "text-ai-tint-foreground" : "text-foreground")}>
                            {c.id}
                          </span>
                          {c.kind === "virtual" ? (
                            <Bot aria-hidden className="h-3 w-3 text-ai-tint-foreground" />
                          ) : c.consentOptOut ? (
                            <ShieldOff aria-hidden className="h-3 w-3 text-destructive" aria-label="拒绝 AI 分析" />
                          ) : (
                            <User aria-hidden className="h-3 w-3 text-muted-foreground" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MATRIX_ROWS.map((row) => {
                    const strong = strongIndependentCount(row);
                    const belowThreshold = strong < MATRIX_WRITING_GUARDS.universalClaimThreshold;
                    return (
                      <tr key={row.theme} data-testid={`itv-matrix-row-${row.theme}`}>
                        <td className="p-1.5">
                          <span className="text-11 text-foreground">{row.theme}</span>
                          <span
                            className={cn("ml-1 text-10", belowThreshold ? "text-warning" : "text-success")}
                            data-testid={`itv-matrix-strong-${row.theme}`}
                          >
                            （独立强证据 {strong}）
                          </span>
                        </td>
                        {MATRIX_COLUMNS.map((c) => {
                          const ev = row.cells[c.id]!;
                          return (
                            <td key={c.id} className="p-1 text-center">
                              <span
                                data-testid={`itv-cell-${row.theme}-${c.id}`}
                                className={cn(
                                  "inline-flex min-w-8 items-center justify-center gap-0.5 rounded-sm border px-1 py-0.5 text-10",
                                  CELL_CLASS[ev],
                                )}
                              >
                                <span className="font-mono">{EVIDENCE_GLYPH[ev]}</span>
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 写作约束 */}
            <div className="mt-3 flex flex-col gap-1.5">
              <p className="flex gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-10 text-foreground" data-testid="itv-guard-emotion">
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                别把少数高情绪当普遍结论：{MATRIX_WRITING_GUARDS.emotionVsEvidence}
              </p>
              <p className="rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-10 text-muted-foreground" data-testid="itv-guard-attribution">
                观点归属：{MATRIX_WRITING_GUARDS.attribution}
              </p>
            </div>
          </Card>

          {/* 候选洞察 + 来源分布 */}
          <div className="grid gap-3 xl:grid-cols-[1fr_260px]">
            <Card className="p-4" data-testid="itv-candidates">
              <span className="text-13 font-medium text-foreground">核心发现 · 每条都能点回原始证据</span>
              <div className="mt-2 flex flex-col gap-2">
                {INSIGHT_CANDIDATES.map((c) => (
                  <div
                    key={c.id}
                    data-testid={`itv-candidate-${c.id}`}
                    className={cn(
                      "rounded-md border p-2.5",
                      c.sourceKind === "virtual"
                        ? "border-ai/30 bg-ai-tint/30"
                        : c.status === "counter-kept"
                          ? "border-destructive/30 bg-destructive/5"
                          : "border-border-subtle bg-panel",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={c.sourceKind === "virtual" ? "ai" : "neutral"}>
                        {c.sourceKind === "virtual" ? (
                          <><Bot aria-hidden className="h-3 w-3" />数字人/画像 · 探索性</>
                        ) : (
                          <><User aria-hidden className="h-3 w-3" />真人</>
                        )}
                      </Badge>
                      <Badge tone={c.strength === "strong" ? "primary" : "outline"}>强度 {c.strength === "strong" ? "强" : c.strength === "weak" ? "弱" : "探索性"}</Badge>
                      {c.status === "confirmed" && <Badge tone="neutral"><CheckCircle2 aria-hidden className="h-3 w-3" />已确认</Badge>}
                      {c.status === "counter-kept" && <Badge tone="danger">反例 · 必须保留</Badge>}
                    </div>
                    <p className="mt-1 text-12 text-foreground">{c.text}</p>
                    <p className="mt-1 text-10 text-muted-foreground">证据：{c.evidence}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Button size="xs" variant="outline" disabled={!canWrite}>看原始证据</Button>
                      {c.canMarkStrong ? (
                        <Button size="xs" variant="ghost" disabled={!canWrite} data-testid={`itv-candidate-mark-strong-${c.id}`}>
                          标为强洞察
                        </Button>
                      ) : (
                        <span
                          className="flex items-center gap-1 rounded-sm border border-border-subtle px-1.5 py-0.5 text-10 text-muted-foreground"
                          data-testid={`itv-candidate-cannot-strong-${c.id}`}
                        >
                          <Lock aria-hidden className="h-3 w-3" />虚拟来源不能标强（接口层拒绝）
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4" data-testid="itv-source-mix">
              <span className="text-12 font-medium text-foreground">洞察来源分布</span>
              <div className="mt-2 flex flex-col gap-1.5">
                {INSIGHT_SOURCE_MIX.items.map((s) => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-11 text-foreground">
                      {s.canStrong ? (
                        <User aria-hidden className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <Bot aria-hidden className="h-3 w-3 text-ai-tint-foreground" />
                      )}
                      {s.label}
                    </span>
                    <Badge tone={s.canStrong ? "neutral" : "ai"}>{s.count}</Badge>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-10 text-muted-foreground">{INSIGHT_SOURCE_MIX.note}</p>
            </Card>
          </div>

          {/* 洞察报告：套报告模板逐章生成 */}
          <Card className="p-4" data-testid="itv-report">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-13 font-medium text-foreground">
                <FileText aria-hidden className="h-4 w-4 text-muted-foreground" />
                洞察报告 · 套报告模板「{rt.name}」逐章生成
              </span>
              <div className="flex gap-1.5">
                {INSIGHT_REPORT_EXPORTS.map((x, i) => (
                  <Button key={x} size="xs" variant={i === 0 ? "primary" : "outline"} disabled={!canWrite} data-testid={`itv-report-export-${i}`}>
                    {x}
                  </Button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-10 text-muted-foreground">{rt.rule}</p>
            <div className="mt-2 flex flex-col gap-1">
              {rt.chapters.map((c) => (
                <div
                  key={c.no}
                  data-testid={`itv-report-out-chapter-${c.no}`}
                  className={cn(
                    "flex items-start gap-2 rounded-md border p-2",
                    c.sourceState === "missing" ? "border-warning/40 bg-warning/5" : "border-border-subtle bg-panel",
                  )}
                >
                  <span className="mt-0.5 text-10 font-semibold text-muted-foreground">{c.no}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-12 text-foreground">{c.title}</span>
                      <Badge tone={c.authoring === "human" ? "outline" : "ai"}>
                        {c.authoring === "human" ? "必须人写" : "AI 起草"}
                      </Badge>
                      {c.sourceState === "missing" ? (
                        <Badge tone="warning">缺来源 · 阻断发布</Badge>
                      ) : (
                        <Badge tone="neutral">已挂证据</Badge>
                      )}
                    </div>
                    <span className="text-10 text-muted-foreground">{c.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </StateShell>
    </section>
  );
}
