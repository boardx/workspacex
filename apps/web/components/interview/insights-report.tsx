"use client";
import * as React from "react";
import {
  Merge, Split, Scale, Columns3, Users, Bot, AlertTriangle, Quote, Sparkles, FileText, ShieldOff,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { UiState } from "@/lib/ui-state";
import {
  INSIGHT_CANDIDATES, INSIGHT_STRENGTH_LABEL, TRANSCRIPT, canWriteInterview,
  type InterviewView,
} from "@/lib/mock/interview";
import {
  MATRIX_COLUMNS, MATRIX_ROWS, MATRIX_SUMMARY, EVIDENCE_LABEL, EVIDENCE_STYLE,
  WRITING_CONSTRAINTS, UNIVERSAL_CLAIM_MIN_INDEPENDENT,
  type Evidence, type MatrixRow,
} from "@/lib/mock/interview-studio";
import { cn } from "@/lib/utils";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const MATRIX_OPS = [
  { id: "merge", label: "合并主题", icon: Merge },
  { id: "split", label: "拆分主题", icon: Split },
  { id: "weight", label: "调整证据权重", icon: Scale },
  { id: "by-type", label: "按用户类型对比", icon: Columns3 },
  { id: "solo-vs-multi", label: "单人 vs 多人场", icon: Users },
] as const;

/** UC-6.5 洞察与报告：单场复盘 / 主题与证据矩阵 / 研究报告草稿 */
export function InsightsReport({ state, view }: { state: UiState; view: InterviewView }) {
  const canWrite = canWriteInterview(view);
  return (
    <div className="flex flex-col gap-4" data-testid="itv-insights-report">
      <Tabs defaultValue="matrix">
        <TabsList data-testid="itv-insight-subtabs">
          <TabsTrigger value="review" data-testid="itv-insight-subtab-review">单场复盘</TabsTrigger>
          <TabsTrigger value="matrix" data-testid="itv-insight-subtab-matrix">主题与证据矩阵 {MATRIX_ROWS.length}</TabsTrigger>
          <TabsTrigger value="report" data-testid="itv-insight-subtab-report">研究报告 草稿</TabsTrigger>
        </TabsList>

        {/* 单场复盘：候选洞察（复用 UC-6.4 数据）*/}
        <TabsContent value="review">
          <StateShell
            state={state}
            emptyHint="本场还没有可回流的转写——先完成现场记录"
            onCreate={() => {}}
            errors={{ anchor: "确认失败：有候选洞察未挂任何原始引述——无来源的候选不可确认（灰置）" }}
            depFailure={{ what: "洞察生成依赖 Context Engine 检索层；服务不可用，已保留已确认洞察，可重试。", retry: () => {} }}
            denial={{ layer: "project", reason: "观察者只能看已发布脱敏结果；候选洞察与原始引述不可见。" }}
            successMessage="洞察『责任归属无人承担』已确认入库，挂 2 条原始引述"
            skeletonRows={4}
          >
            <div className="flex flex-col gap-3" data-testid="itv-insight-candidates">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-14 font-semibold">候选洞察</h2>
                <span className="text-10 text-muted-foreground">
                  强 {INSIGHT_CANDIDATES.filter((i) => i.strength === "strong").length} · 虚拟 {INSIGHT_CANDIDATES.filter((i) => i.strength === "virtual").length}
                </span>
              </div>
              <p className="text-10 text-muted-foreground">
                AI 产出带机器角标与来源角标；无来源的候选不可确认。确认/编辑后确认/忽略三出口留痕。
              </p>
              {INSIGHT_CANDIDATES.map((ins) => (
                <Card key={ins.id} data-testid={`itv-review-insight-${ins.id}`}>
                  <CardContent className="flex flex-col gap-1.5 pt-4">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone={ins.strength === "strong" ? "primary" : ins.strength === "virtual" ? "outline" : "warning"}>
                        {INSIGHT_STRENGTH_LABEL[ins.strength]}
                      </Badge>
                      {ins.machineGenerated && <Badge tone="ai"><Bot aria-hidden className="h-3 w-3" /> AI 候选</Badge>}
                      {ins.confirmed && <Badge tone="primary">已入库</Badge>}
                    </div>
                    <p className="text-12 leading-snug">{ins.text}</p>
                    <div className="flex flex-col gap-1 rounded-sm bg-muted p-1.5">
                      <span className="text-9 font-medium text-muted-foreground">原始引述</span>
                      {ins.quoteSegmentIds.map((sid) => {
                        const seg = TRANSCRIPT.find((s) => s.id === sid);
                        if (!seg) return null;
                        return (
                          <div key={sid} className="flex items-start gap-1 text-10" data-testid={`itv-review-anchor-${ins.id}-${sid}`}>
                            <Quote aria-hidden className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">「{seg.text}」</span>
                            <span className="shrink-0 font-mono text-primary">{seg.tc}</span>
                          </div>
                        );
                      })}
                    </div>
                    {canWrite && !ins.confirmed && (
                      <Button size="xs" variant="ai" onClick={() => {}} data-testid={`itv-review-confirm-${ins.id}`} className="self-start">
                        确认入洞察库
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </StateShell>
        </TabsContent>

        {/* 主题与证据矩阵 */}
        <TabsContent value="matrix">
          <StateShell
            state={state}
            emptyHint="还没有足够的证据成矩阵——建议 ≥3 场访谈或 ≥20 条引述再回流"
            onCreate={() => {}}
            errors={{ merge: "合并会抹掉『责任归属』行里 P-12 的唯一反例——请先确认是否保留" }}
            depFailure={{ what: "矩阵重算依赖检索层；服务不可用，显示的是上次快照，可重试。", retry: () => {} }}
            denial={{ layer: "project", reason: "观察者只能看已发布脱敏结果；证据矩阵含未发布原始归因，不可见。" }}
            successMessage="矩阵已按「单人 vs 多人场」重排，从众风险格子已高亮"
            skeletonRows={6}
          >
            <div className="flex flex-col gap-3" data-testid="itv-matrix">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-14 font-semibold">主题与证据矩阵</h2>
                <Badge tone="outline" data-testid="itv-matrix-summary">
                  {MATRIX_SUMMARY.sessions} 场 · {MATRIX_SUMMARY.respondents} 位（场次数 ≠ 人数）
                </Badge>
              </div>
              {/* 操作条 */}
              <div className="flex flex-wrap gap-1" data-testid="itv-matrix-ops">
                {MATRIX_OPS.map((op) => (
                  <Button key={op.id} size="xs" variant="outline" onClick={() => {}} disabled={!canWrite} data-testid={`itv-matrix-op-${op.id}`}>
                    <op.icon aria-hidden className="h-3 w-3" /> {op.label}
                  </Button>
                ))}
              </div>
              {/* 图例：五种可辨识视觉 */}
              <MatrixLegend />
              {/* 矩阵表 */}
              <MatrixTable />
              {/* 写作约束 */}
              <WritingConstraints />
            </div>
          </StateShell>
        </TabsContent>

        {/* 研究报告草稿 */}
        <TabsContent value="report">
          <div className="flex flex-col gap-2" data-testid="itv-report-draft">
            <div className="flex items-center gap-1.5">
              <FileText aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-14 font-semibold">研究报告草稿</h2>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5">
              <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-11 text-muted-foreground">
                触发「普遍性断言」写作约束的强证据下限 = 独立受访者 {UNIVERSAL_CLAIM_MIN_INDEPENDENT} 人（同一人说三次算 1，O-16）。
                低于此不得写「用户普遍认为」；报告写作工作台在 10-report，本处仅入口占位。
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => {}} className="self-start" data-testid="itv-report-open">
              打开报告工作台（10-report）
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MatrixLegend() {
  const order: Evidence[] = ["strong", "weak", "none", "echo", "counter"];
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="itv-matrix-legend">
      {order.map((e) => (
        <span key={e} className="inline-flex items-center gap-1 text-10 text-muted-foreground" data-testid={`itv-matrix-legend-${e}`}>
          <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-sm text-9 font-bold", EVIDENCE_STYLE[e].tone)}>
            {EVIDENCE_STYLE[e].glyph}
          </span>
          {EVIDENCE_LABEL[e]}
        </span>
      ))}
    </div>
  );
}

function MatrixTable() {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table className="w-full border-collapse text-11">
        <TableHeader>
          <TableRow className="border-b border-border bg-panel">
            <TableHead className="p-2 text-left font-medium text-muted-foreground">主题 · {MATRIX_ROWS.length}</TableHead>
            {MATRIX_COLUMNS.map((c) => (
              <TableHead key={c.id} className="p-2 text-center font-medium" data-testid={`itv-matrix-col-${c.id}`}>
                <span className={cn("inline-flex flex-col items-center gap-0.5", c.virtual && "text-ai-tint-foreground")}>
                  {c.virtual && <Bot aria-hidden className="h-3 w-3 text-ai" />}
                  <span className="font-mono text-10">{c.id}</span>
                  {c.virtual && <span className="text-9 text-ai">虚拟</span>}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {MATRIX_ROWS.map((row) => (
            <MatrixRowView key={row.theme} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MatrixRowView({ row }: { row: MatrixRow }) {
  const [showNote, setShowNote] = React.useState(false);
  return (
    <>
      <TableRow className="border-b border-border-subtle" data-testid={`itv-matrix-row-${row.theme}`}>
        <TableHead className="max-w-40 p-2 text-left align-top font-medium">
          <span className="flex items-center gap-1">
            {row.theme}
            {row.note && (
              <button
                type="button"
                onClick={() => setShowNote((v) => !v)}
                aria-label="看写作约束"
                aria-expanded={showNote}
                data-testid={`itv-matrix-note-toggle-${row.theme}`}
                className="rounded-sm p-0.5 text-warning transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AlertTriangle aria-hidden className="h-3 w-3" />
              </button>
            )}
          </span>
        </TableHead>
        {MATRIX_COLUMNS.map((c) => {
          const ev = row.cells[c.id] ?? "none";
          const style = EVIDENCE_STYLE[ev];
          return (
            <TableCell key={c.id} className="p-1 text-center align-middle" data-testid={`itv-matrix-cell-${row.theme}-${c.id}`}>
              <span
                title={`${EVIDENCE_LABEL[ev]} · ${style.hint}`}
                className={cn("inline-flex h-6 w-6 items-center justify-center rounded-sm text-11 font-bold", style.tone)}
              >
                {style.glyph}
              </span>
            </TableCell>
          );
        })}
      </TableRow>
      {showNote && row.note && (
        <TableRow className="bg-warning/5" data-testid={`itv-matrix-note-${row.theme}`}>
          <TableCell colSpan={MATRIX_COLUMNS.length + 1} className="p-2 text-10 text-muted-foreground">
            <AlertTriangle aria-hidden className="mr-1 inline h-3 w-3 text-warning" />
            {row.note}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function WritingConstraints() {
  return (
    <section className="flex flex-col gap-2" data-testid="itv-writing-constraints">
      <h3 className="text-12 font-semibold">写作约束（必须在界面出现，不是写在文档里）</h3>
      {WRITING_CONSTRAINTS.map((w) => (
        <div key={w.id} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2" data-testid={`itv-constraint-${w.id}`}>
          <ShieldOff aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-11 text-muted-foreground">
            <strong className="text-background-foreground">{w.title}</strong>：{w.body}
          </p>
        </div>
      ))}
    </section>
  );
}
