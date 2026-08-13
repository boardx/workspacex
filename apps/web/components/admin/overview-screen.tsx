"use client";
import * as React from "react";
import { ShieldAlert, Download, FileBarChart, Link2, Check, FlaskConical } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { OverviewLive } from "./overview-live";
import { AdminDrawer, Toast } from "./panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { OVERVIEW_METRICS, OVERVIEW_ANOMALIES, ANOMALY_CHAINS, type AnomalyItem } from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

/**
 * 「组织总览」屏（#1182 起是**混合态**）
 *
 * ## 为什么这一屏有两种数据
 *
 * 人类 2026-08-14 对 Q-12 的裁决：**归属选 A**——屏内容留给 phase-03 的 `17-gov`，
 * `uc-17-1` / `uc-17-7` 不搬进 phase-01。**但**已经有真后端的三格现在就接，不等
 * phase-03 开工；剩下的继续显示演示数据，等 phase-03 **F15**。
 *
 *   真数据（`overview-live.tsx`）  本月 token 消耗 / 活跃成员 / 活动流
 *   演示数据（本文件）             异常待处理（计数卡 + 清单 + 调用链 + 标记为正常）
 *                                 导出 CSV / 生成月度报告（无人认领，见 #1178）
 *
 * ## ⚠ 逐块标记是这一屏的**要求**，不是装饰
 *
 * 裁决原话：「落地时请显式标注哪几格是真数据、哪几格还是演示数据——别让界面看起来
 * 『整屏已完成』」。而 `lint-no-backend-badge` 是**按屏**判定的：本屏一旦 import
 * 任何 `live-*`，那道门就不再要求本屏有任何提示——于是这些标记会只剩人的自觉在守。
 * 所以 `tests/ui/overview-mixed-state.test.tsx` 补了机械断言：**每一个仍读 mock 的
 * 区块都必须带演示标记**，摘掉任一处当场红。
 */

/**
 * lint-no-backend-badge:backed-by-children —— 本屏的真实后端接线在同目录子组件
 * `overview-live.tsx` 里（getUsageReport / queryProvenance / listOrgMembers），
 * 本文件自己只保留仍是演示数据的那几块。那道门按屏判定「有没有 apiRequest / live-*」，
 * 只看本文件会把它误判成零后端并要求挂 NoBackendNotice——而那句话对本屏是错的：
 * 三格已经读真库了。标注会被脚本核实（同目录确有子组件真的在调后端），不是一句自称。
 *
 * ⚠ 代价写在明处：这个标注让本屏对那道门免检，于是演示区块的标记就只剩人的自觉在守。
 *   `tests/ui/overview-mixed-state.test.tsx` 是补上的那道机械门。
 */

/** 演示数据区块的统一标记。集中一处，是为了让测试能逐块断言它存在。 */
export const DEMO_BADGE_TEXT = "演示数据 · 等 phase-03 F15";

function DemoBadge({ testid }: { testid: string }) {
  return (
    <Badge tone="warning" data-testid={testid}>
      <FlaskConical aria-hidden className="mr-1 h-3 w-3" />
      {DEMO_BADGE_TEXT}
    </Badge>
  );
}

export function OverviewScreen({ state }: { state: UiState }) {
  // 乐观状态：已被标记为正常的异常 id + 报告/导出的确认行
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [chainOf, setChainOf] = React.useState<AnomalyItem | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const anomalies = OVERVIEW_ANOMALIES;
  const anomalyMetric = OVERVIEW_METRICS.find((m) => m.key === "anomaly");

  return (
    <AdminScreen
      state={state}
      moduleLabel="总览"
      title="组织总览"
      // 屏级提示如实说明本屏是**混合**态。用 NoBackendNotice 现在是错的（三格已读真库），
      // 什么都不说更错——那正是裁决点名要避免的「整屏已完成」。
      noticeOverride={
        <p className="text-12 text-muted-foreground" data-testid="admin-overview-mixed-notice">
          本屏混合两种数据：token 消耗、活跃成员、活动流读的是真实的组织数据；
          异常相关与导出/月度报告仍是演示数据，逐块标出，等 phase-03 的异常检测落地。
        </p>
      }
      intro="本月消耗、活跃度与需要人处理的异常。异常不是「事后可查」，是「事中拦截」——这里是处置入口。"
      emptyHint="本月还没有活动记录"
      errors={{ report: "生成月度报告失败：审计导出服务返回 500，请稍后重试" }}
      depFailure="用量与越权拦截埋点依赖审计流水线（UC-17.1），当前不可用，指标与活动流无法刷新。"
      denialReason="本页仅组织管理员可见；你当前的组织角色是顾问。"
      successMessage="月度报告已生成，已发送到你的收件箱"
    >
      <div className="flex flex-col gap-5">
        {/* 两块真指标 + 活动流（真数据，见 overview-live.tsx）——异常那块在下面，仍是演示 */}
        <OverviewLive />

        {/* 异常计数卡：仍是演示数据 */}
        <section className="grid grid-cols-1 gap-3" data-testid="admin-overview-metrics">
          <Card data-testid="admin-overview-metric-anomaly">
            <CardContent className="flex flex-col gap-1.5 pt-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-12 text-muted-foreground">{anomalyMetric?.label}</span>
                <DemoBadge testid="admin-overview-metric-anomaly-demo" />
              </div>
              <span className="text-24 font-semibold tracking-tight">{anomalyMetric?.value}</span>
              <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
                <ShieldAlert aria-hidden className="h-3 w-3 text-warning" />
                {anomalyMetric?.delta}
              </span>
            </CardContent>
          </Card>
        </section>

        {/* 异常待处理 */}
        <section className="flex flex-col gap-2" data-testid="admin-overview-anomalies">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-14 font-semibold">
              异常待处理 <span className="text-11 font-normal text-muted-foreground">· {anomalies.length - dismissed.size} 项未处理</span>
            </h2>
            <DemoBadge testid="admin-overview-anomalies-demo" />
          </div>
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

        {/* 导出 / 月度报告：仍是演示——按钮点了只弹 Toast，无人认领，见 #1178。
            ⚠ 刻意没有把它们做成 disabled：那是 #1178 里要人裁的事，
            在这里顺手改等于替那条 issue 做了决定。这里只如实标出它是演示。 */}
        <section className="flex flex-col gap-2" data-testid="admin-overview-reports">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-14 font-semibold">导出与报告</h2>
              <DemoBadge testid="admin-overview-reports-demo" />
            </div>
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
