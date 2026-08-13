"use client";
import * as React from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { getUsageReport, listOrgMembers, type GetUsageReportOut } from "@/lib/live-org-admin";
import { queryProvenance, type ProvenanceEvent } from "@/lib/live-provenance";
import { PROVENANCE_EVENT_LABEL } from "@/lib/provenance-labels";

/**
 * #1182 —— 总览屏**三个已经有真后端的格子**接真端点。
 *
 * 人类 2026-08-14 对 Q-12 的裁决：归属选 A（屏内容留给 phase-03），
 * **但**已经有真后端的三格现在就接，不等 phase-03；且落地时要显式标注
 * 哪几格是真、哪几格还是演示——别让界面看起来「整屏已完成」。
 *
 *   本月 token 消耗  `GET /organizations/:orgId/usage`.totalTokens        （F159+F161）
 *   活跃成员        同上 `.activeMemberCount`                            （F161）
 *   活动流          `GET /provenance`                                    （F03/F08）
 *
 * 异常三格与导出两个按钮**仍是演示数据**，留在 `overview-screen.tsx` 里并各自带标记。
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

/** 千分位。`Intl` 而不是自己写正则——同一个格式在别处也是这么出的。 */
const fmt = new Intl.NumberFormat("zh-CN");

export function OverviewLive() {
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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

  return (
    <>
      {/* ── 两块真指标 ── */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="admin-overview-live-metrics">
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
