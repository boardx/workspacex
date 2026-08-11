"use client";
import * as React from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  USAGE_WINDOWS, USAGE_WINDOW_DEFAULT, USAGE_STAT_CARDS,
  USAGE_MATRIX_MODELS, USAGE_MATRIX_ROWS, USAGE_MATRIX_FOOTER,
  MODEL_DISTRIBUTION, RECENT_LIMIT_EVENTS, type UsageWindowKey,
} from "@/lib/mock/admin-limits";

/** 概览卡的色调 —— 与 `UsageStatCard.tone` 对齐，不用 opacity 表达强调 */
function statValueTone(tone: "default" | "warning" | "destructive"): string {
  if (tone === "destructive") return "text-destructive";
  if (tone === "warning") return "text-warning";
  return "text-card-foreground";
}

function eventTagTone(tone: "warning" | "destructive" | "success"): "warning" | "danger" | "primary" {
  if (tone === "destructive") return "danger";
  if (tone === "warning") return "warning";
  return "primary";
}

/**
 * 用量监控 tab（isMbUsage，字节偏移 15870471-15889337）—— 统计窗口切换、
 * 四张概览卡、按人×模型用量矩阵、按模型分布、近期限额事件。
 * 窗口切换只影响本地展示态（无后端），不真正拉取不同窗口的数据——mock 定死一份「本周」快照。
 */
export function UsageMonitorTab() {
  const [windowKey, setWindowKey] = React.useState<UsageWindowKey>(USAGE_WINDOW_DEFAULT);

  return (
    <div className="flex flex-col gap-5" data-testid="admin-usage-tab">
      {/* 统计窗口切换 */}
      <div className="flex flex-wrap items-center gap-2" data-testid="admin-usage-window">
        <span className="text-11 text-muted-foreground">统计窗口</span>
        <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {USAGE_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindowKey(w)}
              data-testid={`admin-usage-window-${w}`}
              aria-pressed={windowKey === w}
              className={
                "h-6 rounded-md px-2.5 text-11 transition-colors duration-200 " +
                (windowKey === w
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-background-foreground")
              }
            >
              {w}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-10 text-muted-foreground">更新于 1 分钟前 · 单位：万 token</span>
      </div>

      {/* 四张概览卡（数值固定为「本周」快照，切窗口只换选中态，如实标注见上） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="admin-usage-stats">
        {USAGE_STAT_CARDS.map((c) => (
          <Card key={c.key} data-testid={`admin-usage-stat-${c.key}`}>
            <CardContent className="flex flex-col gap-1.5 pt-3">
              <span className="text-11 text-muted-foreground">{c.label}</span>
              <span className={`font-serif text-24 font-medium ${statValueTone(c.tone)}`}>
                {c.value}
                {c.unit && <span className="ml-1 text-11 font-sans text-muted-foreground">{c.unit}</span>}
              </span>
              <span className="font-mono text-10 text-muted-foreground">{c.sub}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 按人 × 模型用量矩阵 */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <BarChart3 aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-14 font-semibold">按人 × 模型</h2>
          <span className="ml-auto text-10 text-muted-foreground">最后一列是本周个人额度用掉的比例</span>
        </div>
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] border-collapse text-11" data-testid="admin-usage-matrix">
              <thead>
                <tr className="border-b border-border bg-panel text-11 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">成员</th>
                  {USAGE_MATRIX_MODELS.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium font-mono">{m}</th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">合计</th>
                  <th className="px-3 py-2 text-left font-medium">额度用量</th>
                </tr>
              </thead>
              <tbody>
                {USAGE_MATRIX_ROWS.map((r) => (
                  <tr key={r.id} className="border-b border-border-subtle" data-testid={`admin-usage-matrix-row-${r.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-10 text-muted-foreground">{r.subtitle}</div>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={USAGE_MATRIX_MODELS[i]} className="px-2 py-2 text-right font-mono text-muted-foreground">{v}</td>
                    ))}
                    <td className="px-2 py-2 text-right font-mono font-medium">{r.total}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${r.quotaPct >= 90 ? "bg-destructive" : "bg-foreground"}`}
                            style={{ width: `${Math.min(100, r.quotaPct)}%` }}
                          />
                        </div>
                        <span className={`font-mono text-10 ${r.quotaPct >= 90 ? "text-destructive" : "text-muted-foreground"}`}>{r.quotaPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="bg-panel font-medium" data-testid="admin-usage-matrix-footer">
                  <td className="px-3 py-2">{USAGE_MATRIX_FOOTER.label}</td>
                  {USAGE_MATRIX_FOOTER.values.map((v, i) => (
                    <td key={USAGE_MATRIX_MODELS[i]} className="px-2 py-2 text-right font-mono">{v}</td>
                  ))}
                  <td className="px-2 py-2 text-right font-mono">{USAGE_MATRIX_FOOTER.total}</td>
                  <td className="px-3 py-2 text-10 font-normal text-muted-foreground">{USAGE_MATRIX_FOOTER.note}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* 按模型分布 + 近期限额事件 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card data-testid="admin-usage-model-distribution">
          <CardContent className="flex flex-col gap-2.5 pt-4">
            <span className="text-12 font-medium">按模型分布</span>
            {MODEL_DISTRIBUTION.map((m) => (
              <div key={m.key} data-testid={`admin-usage-distribution-${m.key}`}>
                <div className="mb-1 flex items-center gap-2 text-11">
                  <span className="flex-1 truncate">{m.label}</span>
                  <span className="font-mono text-10">{m.pct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${m.colorVar}`} style={{ width: `${m.pct}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="admin-usage-recent-events">
          <CardContent className="flex flex-col gap-2.5 pt-4">
            <span className="text-12 font-medium">近期限额事件</span>
            {RECENT_LIMIT_EVENTS.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2" data-testid={`admin-usage-event-${ev.id}`}>
                <Badge tone={eventTagTone(ev.tone)}>{ev.tag}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-11 leading-relaxed">{ev.detail}</p>
                  <p className="font-mono text-9 text-muted-foreground">{ev.meta}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
