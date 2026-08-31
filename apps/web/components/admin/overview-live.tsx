"use client";
import * as React from "react";
import { TrendingUp, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { getUsageReport, listOrgMembers, listLimitEvents, type GetUsageReportOut, type ListLimitEventsOut } from "@/lib/live-org-admin";
import { queryProvenance, type ProvenanceEvent } from "@/lib/live-provenance";
import { PROVENANCE_EVENT_LABEL } from "@/lib/provenance-labels";

/**
 * #1182 起总览屏三格接真后端；2026-08-30 起「异常待处理」也接上（F162 `listLimitEvents`
 * 落地之后）——整屏因此**不再是混合态**，见本文件与 `overview-screen.tsx` 的改动。
 *
 * 人类 2026-08-14 对 Q-12 的裁决：归属选 A（屏内容留给 phase-03），
 * **但**已经有真后端的格子现在就接，不等 phase-03；且落地时要显式标注
 * 哪几格是真、哪几格还是演示——别让界面看起来「整屏已完成」。
 *
 *   本月 token 消耗  `GET /organizations/:orgId/usage`.totalTokens        （F159+F161）
 *   活跃成员        同上 `.activeMemberCount`                            （F161）
 *   活动流          `GET /provenance`                                    （F03/F08）
 *   限额事件        `GET /organizations/:orgId/limit-events`             （F162）
 *
 * ## 「限额事件」不是「异常检测」
 *
 * phase-03 F15（越权调用识别、额度异常的模式识别）仍未落地——这里读到的是**已经存在**
 * 的限额规则触发记录（F162），是「组织自己设的阈值被越过」，不是「系统主动判定出一条
 * 反常行为」。两者是不同的能力，命名上不该混为一谈，所以这块的标题就叫「限额事件」，
 * 不叫「异常待处理」——那个名字要留给 F15 真正落地的那一天。
 *
 * ## 「活跃成员」不是「成员总数」
 *
 * 契约逐字：「窗口内**有过调用**的人数——不是组织成员总数」。所以这里绝不能顺手换成
 * `listOrgMembers().length`——那个数永远更大、永远更好看，且没有任何东西会发现它错了。
 *
 * ## 活动流的两个折衷（是折衷，不是遗漏）
 *
 * ① `ProvenanceEvent` 没有自由文本的「做了什么」，只有闭集 `type` + `target` 二元组。
 *    文案由 `type` 推导（`provenance-labels.ts`），那份表对枚举穷尽且有断言守着——
 *    漏一个类型会渲染空白，而空白在审计流里读作「这条没事发生」。
 * ② `actorId` 不是显示名，要靠 `listOrgMembers` 映射。**映射不到就显示 id**，
 *    不隐藏该行：隐藏会让审计流少掉记录，那比显示一个丑 id 严重得多
 *    （已离开组织的人、系统身份，都会映射不到）。
 */

type Loaded = {
  readonly usage: GetUsageReportOut;
  readonly events: readonly ProvenanceEvent[];
  readonly names: ReadonlyMap<string, { displayName: string; orgRole: string }>;
};

const ORG_ROLE_LABEL: Record<string, string> = {
  admin: "管理员", lead: "负责人", consultant: "顾问", compliance: "合规",
};

/** 触顶动作的中文标签 —— 与 `usage-monitor-tab.tsx` 同源于契约枚举 `LimitAction`。 */
const ACTION_LABEL: Record<string, string> = {
  warn: "预警", degrade: "已降级", block: "已拒绝", require_approval: "待批准",
};

/** 千分位。`Intl` 而不是自己写正则——同一个格式在别处也是这么出的。 */
const fmt = new Intl.NumberFormat("zh-CN");

export function OverviewLive() {
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [limitEvents, setLimitEvents] = React.useState<ListLimitEventsOut["events"] | null>(null);
  const [limitError, setLimitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [usage, provenance, members] = await Promise.all([
          getUsageReport(orgId, "month"),
          queryProvenance(orgId, 20),
          listOrgMembers(orgId),
        ]);
        if (cancelled) return;
        setData({
          usage,
          events: provenance.events,
          names: new Map(members.members.map((m) => [
            m.userId, { displayName: m.displayName, orgRole: m.orgRole },
          ])),
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const out = await listLimitEvents(orgId);
        if (!cancelled) setLimitEvents(out.events);
      } catch (err) {
        if (!cancelled) {
          setLimitError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const blockingCount = limitEvents?.filter((e) => e.actionTaken === "block" || e.actionTaken === "degrade").length ?? null;

  return (
    <>
      {/* ── 三块真指标 ── */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="admin-overview-live-metrics">
        <MetricCard
          testid="admin-overview-metric-tokens"
          label="本月 token 消耗"
          value={data ? fmt.format(data.usage.totalTokens) : null}
          foot={data ? `${fmt.format(data.usage.callCount)} 次调用 · 其中 ${fmt.format(data.usage.failedCallCount)} 次失败` : null}
          error={error}
        />
        <MetricCard
          testid="admin-overview-metric-members"
          label="活跃成员"
          value={data ? `${fmt.format(data.usage.activeMemberCount)} 人` : null}
          // 说清楚它是什么，否则「活跃成员 3 人」会被读成「组织只有 3 个人」。
          foot="本月有过调用的人数，不是成员总数"
          error={error}
        />
        <MetricCard
          testid="admin-overview-metric-anomaly"
          label="限额事件"
          value={limitEvents ? `${fmt.format(limitEvents.length)} 项` : null}
          foot={
            limitEvents
              ? blockingCount !== null && blockingCount > 0
                ? `其中 ${blockingCount} 项已阻断/降级`
                : "近期没有被拒绝或降级的调用"
              : null
          }
          error={limitError}
        />
      </section>

      {/* ── 限额事件（F162 真数据；不是 phase-03 F15 的异常检测） ── */}
      <section className="flex flex-col gap-2" data-testid="admin-overview-anomalies">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-14 font-semibold">限额事件</h2>
          <Badge tone="outline" data-testid="admin-overview-anomalies-live">真数据</Badge>
          <span className="text-11 text-muted-foreground">
            组织自设的限额规则被触发时留下的记录；识别越权调用等异常模式的能力尚未落地（phase-03）。
          </span>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            {limitError && (
              <p className="text-12 text-muted-foreground" data-testid="admin-overview-anomalies-load-failed">
                读不到限额事件（{limitError}）。这里不退回演示数据——假的异常记录会被当成真的处置依据。
              </p>
            )}
            {limitEvents?.length === 0 && (
              <p className="text-12 text-muted-foreground" data-testid="admin-overview-anomalies-empty">
                近期没有任何限额规则被触发。
              </p>
            )}
            {(limitEvents ?? []).slice(0, 5).map((ev, i) => (
              <div key={ev.eventId} data-testid={`admin-overview-anomaly-${ev.eventId}`}>
                <div className="flex items-start gap-2 py-1.5">
                  <Badge tone={ev.actionTaken === "block" ? "danger" : ev.actionTaken === "warn" ? "warning" : "primary"}>
                    <ShieldAlert aria-hidden className="mr-1 h-3 w-3" />
                    {ACTION_LABEL[ev.actionTaken] ?? ev.actionTaken}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-12 leading-relaxed">
                      {ev.subjectRef} 触顶：观测 {fmt.format(ev.observedTokens)} / 上限 {fmt.format(ev.thresholdTokens)}
                    </p>
                    <p className="font-mono text-10 text-muted-foreground">
                      {new Date(ev.occurredAt).toLocaleString("zh-CN")}
                      {ev.ruleId === "" ? " · 规则已删除" : ` · 规则 ${ev.ruleId.slice(0, 8)}`}
                    </p>
                  </div>
                </div>
                {i < Math.min(5, limitEvents?.length ?? 0) - 1 && <Separator />}
              </div>
            ))}
            {limitEvents && limitEvents.length > 5 && (
              <a
                href="/admin/members"
                className="self-start text-11 text-primary hover:underline"
                data-testid="admin-overview-anomalies-more"
              >
                查看全部 {fmt.format(limitEvents.length)} 项 → 成员配额 · 限额策略
              </a>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── 活动流 ── */}
      <section className="flex flex-col gap-2" data-testid="admin-overview-activity">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-14 font-semibold">活动流</h2>
          <Badge tone="outline" data-testid="admin-overview-activity-live">真数据</Badge>
        </div>
        <Card>
          <CardContent className="flex flex-col pt-2">
            {error && (
              <p className="py-2 text-12 text-muted-foreground" data-testid="admin-overview-load-failed">
                读不到审计流（{error}）。这里不退回演示数据——假的活动流会被当成真的审计记录。
              </p>
            )}
            {data?.events.length === 0 && (
              <p className="py-2 text-12 text-muted-foreground" data-testid="admin-overview-activity-empty">
                这个组织还没有任何审计事件。
              </p>
            )}
            {(data?.events ?? []).map((e, i) => {
              const who = data?.names.get(e.actorId);
              return (
                <div key={e.id} data-testid={`admin-activity-${e.id}`}>
                  <div className="flex items-baseline gap-3 py-2">
                    <span className="w-20 shrink-0 truncate text-12 font-medium" title={e.actorId}>
                      {who?.displayName ?? e.actorId}
                    </span>
                    <Badge tone="outline" className="shrink-0">
                      {who ? (ORG_ROLE_LABEL[who.orgRole] ?? who.orgRole) : "已不在组织"}
                    </Badge>
                    <span className="min-w-0 flex-1 text-12">{PROVENANCE_EVENT_LABEL[e.type]}</span>
                    <span className="shrink-0 text-11 text-muted-foreground">
                      {new Date(e.at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  {i < (data?.events.length ?? 0) - 1 && <Separator />}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function MetricCard(props: {
  testid: string; label: string; value: string | null; foot: string | null; error: string | null;
}) {
  return (
    <Card data-testid={props.testid}>
      <CardContent className="flex flex-col gap-1.5 pt-4">
        <div className="flex items-center gap-1.5">
          <span className="text-12 text-muted-foreground">{props.label}</span>
          <Badge tone="outline">真数据</Badge>
        </div>
        <span className="text-24 font-semibold tracking-tight">
          {/* 读不到时显示 —— 而不是 0。「查询失败」与「本月真的是 0」是两件事，
              显示 0 会让一次故障看起来像一个平静的月份。 */}
          {props.error ? "—" : (props.value ?? "…")}
        </span>
        {props.foot && (
          <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
            <TrendingUp aria-hidden className="h-3 w-3" />
            {props.foot}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
