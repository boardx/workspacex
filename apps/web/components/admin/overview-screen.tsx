"use client";
import * as React from "react";
import { TrendingUp, TrendingDown, Minus, ShieldAlert, Download, FileBarChart, Link2, Check } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { NoBackendNotice } from "./no-backend-notice";
import { AdminDrawer, Toast } from "./panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  OVERVIEW_METRICS, OVERVIEW_ANOMALIES, OVERVIEW_ACTIVITY, ANOMALY_CHAINS,
  type AnomalyItem,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

export function OverviewScreen({ state }: { state: UiState }) {
  // 乐观状态：已被标记为正常的异常 id + 报告/导出的确认行
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [chainOf, setChainOf] = React.useState<AnomalyItem | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const anomalies = OVERVIEW_ANOMALIES;

  return (
    <AdminScreen
      state={state}
      moduleLabel="总览"
      title="组织总览"
      noticeOverride={<NoBackendNotice />}
      intro="本月消耗、活跃度与需要人处理的异常。异常不是「事后可查」，是「事中拦截」——这里是处置入口。"
      emptyHint="本月还没有活动记录"
      errors={{ report: "生成月度报告失败：审计导出服务返回 500，请稍后重试" }}
      depFailure="用量与越权拦截埋点依赖审计流水线（UC-17.1），当前不可用，指标与活动流无法刷新。"
      denialReason="本页仅组织管理员可见；你当前的组织角色是顾问。"
      successMessage="月度报告已生成，已发送到你的收件箱"
    >
      <div className="flex flex-col gap-5">
        {/* 三块指标卡 */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="admin-overview-metrics">
          {OVERVIEW_METRICS.map((m) => {
            const Trend = TREND_ICON[m.trend];
            const isAnomaly = m.key === "anomaly";
            return (
              <Card key={m.key} data-testid={`admin-overview-metric-${m.key}`}>
                <CardContent className="flex flex-col gap-1.5 pt-4">
                  <span className="text-12 text-muted-foreground">{m.label}</span>
                  <span className="text-24 font-semibold tracking-tight">{m.value}</span>
                  <span className={isAnomaly ? "inline-flex items-center gap-1 text-11 text-muted-foreground" : "inline-flex items-center gap-1 text-11 text-success"}>
                    {isAnomaly ? <ShieldAlert aria-hidden className="h-3 w-3 text-warning" /> : <Trend aria-hidden className="h-3 w-3" />}
                    {m.delta}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </section>

        {/* 异常待处理 */}
        <section className="flex flex-col gap-2" data-testid="admin-overview-anomalies">
          <h2 className="text-14 font-semibold">
            异常待处理 <span className="text-11 font-normal text-muted-foreground">· {anomalies.length - dismissed.size} 项未处理</span>
          </h2>
          <div className="flex flex-col gap-2">
            {anomalies.map((a) => {
              const isDismissed = dismissed.has(a.id);
              return (
                <Card key={a.id} data-testid={`admin-anomaly-${a.id}`}>
                  <CardContent className="flex flex-col gap-2 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={isDismissed ? "neutral" : a.severity === "high" ? "danger" : "warning"} data-testid={`admin-anomaly-severity-${a.id}`}>
                        {isDismissed ? "已标记正常" : a.severity === "high" ? "高" : "中"}
                      </Badge>
                      <span className="text-12 font-medium">{a.kind}</span>
                    </div>
                    <p className={isDismissed ? "text-13 text-muted-foreground line-through" : "text-13"}>{a.detail}</p>
                    {isDismissed ? (
                      <p className="inline-flex items-center gap-1 text-11 text-success" data-testid={`admin-anomaly-resolved-${a.id}`}>
                        <Check aria-hidden className="h-3 w-3" /> 已判定为正常，处置已写入审计（可在活动流复核）
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setChainOf(a)} data-testid={`admin-anomaly-chain-${a.id}`}>
                          <Link2 aria-hidden className="h-3.5 w-3.5" />
                          查看调用链
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDismissed((s) => new Set(s).add(a.id));
                            setToast(`已把「${a.kind}」标记为正常，处置记入审计`);
                          }}
                          data-testid={`admin-anomaly-dismiss-${a.id}`}
                        >
                          标记为正常
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* 活动流 */}
        <section className="flex flex-col gap-2" data-testid="admin-overview-activity">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-14 font-semibold">活动流</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setToast(`已导出活动流 CSV（12,408 条，含在跑的重活标记）`)}
                data-testid="admin-activity-export"
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
                导出
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => setToast(`月度报告生成中…完成后发送到你的收件箱（含用量、异常处置、越权拦截汇总）`)}
                data-testid="admin-activity-report"
              >
                <FileBarChart aria-hidden className="h-3.5 w-3.5" />
                生成月度报告
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="flex flex-col pt-2">
              {OVERVIEW_ACTIVITY.map((item, i) => (
                <div key={item.id} data-testid={`admin-activity-${item.id}`}>
                  <div className="flex items-baseline gap-3 py-2">
                    <span className="w-14 shrink-0 text-12 font-medium">{item.who}</span>
                    <Badge tone="outline" className="shrink-0">{item.role}</Badge>
                    <span className="min-w-0 flex-1 text-12">{item.action}</span>
                    <span className="shrink-0 text-11 text-muted-foreground">{item.when}</span>
                  </div>
                  {i < OVERVIEW_ACTIVITY.length - 1 && <Separator />}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>

      {chainOf && (
        <AdminDrawer
          testid="admin-anomaly-chain-drawer"
          title="调用链"
          subtitle={`${chainOf.kind} · ${chainOf.severity === "high" ? "高" : "中"}危`}
          onClose={() => setChainOf(null)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-12 text-muted-foreground">{chainOf.detail}</p>
            <Separator />
            <ol className="flex flex-col gap-2" data-testid="admin-anomaly-chain-steps">
              {(ANOMALY_CHAINS[chainOf.id] ?? []).map((s, i) => (
                <li
                  key={i}
                  data-testid="admin-anomaly-chain-step"
                  className={`flex flex-col gap-0.5 rounded-md border p-2.5 ${s.blocked ? "border-destructive/30 bg-destructive/5" : "border-border-subtle bg-panel"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-10 text-muted-foreground">{s.ts}</span>
                    <span className="text-12 font-medium">{s.actor}</span>
                    {s.blocked && <Badge tone="danger">拦截点</Badge>}
                  </div>
                  <p className="text-11 text-muted-foreground">{s.action}</p>
                </li>
              ))}
            </ol>
          </div>
        </AdminDrawer>
      )}

      <Toast message={toast} testid="admin-overview-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}
