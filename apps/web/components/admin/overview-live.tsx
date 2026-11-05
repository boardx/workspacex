"use client";
import * as React from "react";
import { TrendingUp, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useOptionalSession } from "@/components/session/session-provider";
import { describeFailure } from "@/lib/design-failure";
import { memberRoleLabel } from "@/lib/admin-member-copy";
import { useI18n } from "@/lib/i18n/provider";
import { getUsageReport, listOrgMembers, listLimitEvents, type GetUsageReportOut, type ListLimitEventsOut } from "@/lib/live-org-admin";
import { queryProvenance, type ProvenanceEvent } from "@/lib/live-provenance";
import { provenanceEventLabel } from "@/lib/provenance-labels";

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
 *
 * ## 为什么整个组件用 `key={orgId}` 包一层，而不是在 effect 里清空 state（PR #2425 二轮独立审查）
 *
 * 第一版修法是「`orgId` 一变，两个 effect 里各自同步清空自己的 state」。独立审查指出这
 * 仍然太晚：`orgId` 变化触发的那次渲染，`useEffect` 是**提交之后**才跑的被动效果——
 * 这中间存在一次「新组织身份 + 旧组织数据（用量/活动流/限额事件，都是审计级别的敏感
 * 信息）」被真实提交到屏幕的渲染，只是测试里的 `act()` 会把它和后续的 effect 更新
 * 一起 flush 掉，看不出来，不代表真实浏览器不会画出这一帧。
 *
 * 真正的堵法是让「这份数据属于哪个组织」变成渲染时的结构性事实，而不是靠事后清空。
 * 做法是把真正持有 state 的部分整体挪进 `OverviewLiveInner`，由外层 `OverviewLive`
 * 用 `key={orgId}` 挂载它——`orgId` 一变，旧实例连同它的全部 state 被 React 直接丢弃，
 * 换一个从初始 state（全部是 `null`，即「还没有任何数据」）开始的全新实例，这个替换
 * 发生在同一次协调里，不存在中间态可以被提交。
 */

type Loaded = {
  readonly usage: GetUsageReportOut;
  readonly events: readonly ProvenanceEvent[];
  readonly names: ReadonlyMap<string, { displayName: string; orgRole: string }>;
};

export function OverviewLive() {
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  // `key={orgId}` 是这里的重点：见上方文件头注「为什么用 key 而不是 effect 清空」。
  return <OverviewLiveInner key={orgId ?? "__no_org__"} orgId={orgId} />;
}

/**
 * 只持有「这一个 orgId 的数据」——`orgId` 变化时整个实例被外层的 `key` 换掉重新挂载，
 * 初始 state 永远是全 `null`（「还没有任何数据」），不存在跨组织残留的可能。
 */
function OverviewLiveInner({ orgId }: { orgId: string | null }) {
  const { t, locale } = useI18n();
  const fmt = new Intl.NumberFormat(locale);
  const ACTION_LABEL: Record<string, string> = {
    warn: t("aiUsage.warning"), degrade: t("aiUsage.degraded"),
    block: t("aiUsage.blocked"), require_approval: t("aiUsage.awaitingApproval"),
  };
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<{ cause: unknown } | null>(null);
  const [limitEvents, setLimitEvents] = React.useState<ListLimitEventsOut["events"] | null>(null);
  const [limitError, setLimitError] = React.useState<{ cause: unknown } | null>(null);

  React.useEffect(() => {
    if (!orgId) return; // 初始 state 已经是全空（见上），没有请求要发。
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
          setError({ cause: err });
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
          setLimitError({ cause: err });
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
          label={t("adminOverview.tokens")}
          value={data ? fmt.format(data.usage.totalTokens) : null}
          foot={data ? t("adminOverview.calls", { calls: fmt.format(data.usage.callCount), failed: fmt.format(data.usage.failedCallCount) }) : null}
          error={error !== null}
        />
        <MetricCard
          testid="admin-overview-metric-members"
          label={t("aiUsage.activeMembers")}
          value={data ? t("adminOverview.people", { count: fmt.format(data.usage.activeMemberCount) }) : null}
          // 说清楚它是什么，否则「活跃成员 3 人」会被读成「组织只有 3 个人」。
          foot={t("adminOverview.activeFoot")}
          error={error !== null}
        />
        <MetricCard
          testid="admin-overview-metric-anomaly"
          label={t("adminOverview.limitEvents")}
          value={limitEvents ? t("adminOverview.items", { count: fmt.format(limitEvents.length) }) : null}
          foot={
            limitEvents
              ? blockingCount !== null && blockingCount > 0
                ? t("adminOverview.blocked", { count: fmt.format(blockingCount) })
                : t("adminOverview.noBlocked")
              : null
          }
          error={limitError !== null}
        />
      </section>

      {/* ── 限额事件（F162 真数据；不是 phase-03 F15 的异常检测） ── */}
      <section className="flex flex-col gap-2" data-testid="admin-overview-anomalies">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-14 font-semibold">{t("adminOverview.limitEvents")}</h2>
          <Badge tone="outline" data-testid="admin-overview-anomalies-live">{t("adminOverview.liveData")}</Badge>
          <span className="text-11 text-muted-foreground">
            {t("adminOverview.limitHint")}
          </span>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            {limitError && (
              <p className="text-12 text-muted-foreground" data-testid="admin-overview-anomalies-load-failed">
                {t("adminOverview.limitFailure", { error: describeFailure(limitError.cause, locale) })}
              </p>
            )}
            {limitEvents?.length === 0 && (
              <p className="text-12 text-muted-foreground" data-testid="admin-overview-anomalies-empty">
                {t("aiUsage.noLimitRulesTriggeredRecently")}
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
                      {t("aiUsage.limitReached", { subject: ev.subjectRef, observed: fmt.format(ev.observedTokens), threshold: fmt.format(ev.thresholdTokens) })}
                    </p>
                    <p className="font-mono text-10 text-muted-foreground">
                      {new Date(ev.occurredAt).toLocaleString(locale)}
                      {ev.ruleId === "" ? t("aiUsage.ruleDeleted") : t("aiUsage.ruleRef", { id: ev.ruleId.slice(0, 8) })}
                    </p>
                  </div>
                </div>
                {i < Math.min(5, limitEvents?.length ?? 0) - 1 && <Separator />}
              </div>
            ))}
            {limitEvents && limitEvents.length > 5 && (
              <a
                href="/admin/members"
                className="self-start text-11 text-primary transition-colors duration-base hover:underline"
                data-testid="admin-overview-anomalies-more"
              >
                {t("adminOverview.moreLimits", { count: fmt.format(limitEvents.length) })}
              </a>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── 活动流 ── */}
      <section className="flex flex-col gap-2" data-testid="admin-overview-activity">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-14 font-semibold">{t("adminOverview.activityStream")}</h2>
          <Badge tone="outline" data-testid="admin-overview-activity-live">{t("adminOverview.liveData")}</Badge>
        </div>
        <Card>
          <CardContent className="flex flex-col pt-2">
            {error && (
              <p className="py-2 text-12 text-muted-foreground" data-testid="admin-overview-load-failed">
                {t("adminOverview.auditFailure", { error: describeFailure(error.cause, locale) })}
              </p>
            )}
            {data?.events.length === 0 && (
              <p className="py-2 text-12 text-muted-foreground" data-testid="admin-overview-activity-empty">
                {t("adminOverview.auditEmpty")}
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
                      {who ? memberRoleLabel(who.orgRole, t) : t("adminOverview.leftOrg")}
                    </Badge>
                    <span className="min-w-0 flex-1 text-12">{provenanceEventLabel(e.type, locale)}</span>
                    <span className="shrink-0 text-11 text-muted-foreground">
                      {new Date(e.at).toLocaleString(locale)}
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
  testid: string; label: string; value: string | null; foot: string | null; error: boolean;
}) {
  const { t } = useI18n();
  return (
    <Card data-testid={props.testid}>
      <CardContent className="flex flex-col gap-1.5 pt-4">
        <div className="flex items-center gap-1.5">
          <span className="text-12 text-muted-foreground">{props.label}</span>
          <Badge tone="outline">{t("adminOverview.liveData")}</Badge>
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
