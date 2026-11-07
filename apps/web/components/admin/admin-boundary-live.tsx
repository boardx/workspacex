"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { EyeOff, ScrollText, FileClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOptionalSession } from "@/components/session/session-provider";
import { memberFailure } from "@/lib/admin-member-copy";
import {
  getPersonalLayerSummary, listMyAccessLog, listOrgMembers,
  type ListMyAccessLogOut,
} from "@/lib/live-org-admin";

/**
 * F163 —— 「你作为管理员看不到什么」接**既有**真端点。
 *
 * ## 本组件不新增任何后端
 *
 * `GET /identity/personal-layer/summary` 与 `GET /admin-access-log/mine` 在 F06 就已经
 * 实现并 passing（D-18 两侧都做完了），只是前端一直没接：界面上那两块读的是
 * `lib/mock/admin.MEMBERS.privateEntries` 与 `ADMIN_ACCESS_LOGS`。所以这是纯接线。
 *
 * ## 为什么「内容不可见」这件事不靠界面自觉
 *
 * `getPersonalLayerSummary` 的响应体**结构上就没有内容字段**——契约注释逐字要求
 * content/body/text/excerpt/preview/snippet 任何一种都不得出现，理由是「空串会随实现
 * 变化被填上，缺字段不会」。前端因此不可能不小心把内容渲染出来：它手里根本没有。
 * 界面上的「内容不可见」徽标是在**说明**这条约束，不是在**执行**它。
 *
 * ## 逐人一次请求
 *
 * 契约的 `getPersonalLayerSummary` 一次只答一个人（`in` 里是单个 `userId`）。组织成员
 * 是几十人量级、这是后台管理屏，并发发出去可以接受；不为此新造一个批量端点——
 * 那需要新的签核，而 F163 的全部价值就是「不新增契约地把已有的真数接上」。
 */
export function AdminBoundaryLive() {
  const { t, locale } = useI18n();
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [counts, setCounts] = React.useState<
    { userId: string; displayName: string; itemCount: number }[] | null
  >(null);
  const [logs, setLogs] = React.useState<ListMyAccessLogOut["entries"] | null>(null);
  const [error, setError] = React.useState<{ cause: unknown } | null>(null);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { members } = await listOrgMembers(orgId);
        const summaries = await Promise.all(members.map(async (m) => ({
          userId: m.userId,
          displayName: m.displayName,
          itemCount: (await getPersonalLayerSummary(orgId, m.userId)).itemCount,
        })));
        if (!cancelled) setCounts(summaries);
      } catch (err) {
        if (!cancelled) {
          setError({ cause: err });
        }
      }
    })();
    void (async () => {
      try {
        const out = await listMyAccessLog();
        if (!cancelled) setLogs(out.entries);
      } catch {
        // 访问记录读不到不该让整块边界说明消失——那段说明本身是产品承诺，不是数据。
        if (!cancelled) setLogs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const withEntries = (counts ?? []).filter((c) => c.itemCount > 0);

  return (
    <section className="flex flex-col gap-2" data-testid="admin-members-boundary">
      <div className="flex items-center gap-1.5">
        <EyeOff aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-14 font-semibold">{t("adminMemberQuotas.boundary")}</h2>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-12 text-muted-foreground">
            {t("adminMemberQuotas.boundaryExplanation")}
          </p>

          <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3" data-testid="admin-members-private-counts">
            <span className="text-12 font-medium">{t("adminMemberQuotas.privateLayer")}</span>
            {error && (
              <span className="text-11 text-destructive" data-testid="admin-boundary-counts-failed">
                {t("adminMemberQuotas.privateFailed", { error: memberFailure(error.cause, locale) })}
              </span>
            )}
            {!error && counts === null && <span className="text-11 text-muted-foreground">{t("adminMemberQuotas.loading")}</span>}
            {!error && counts !== null && withEntries.length === 0 && (
              <span className="text-11 text-muted-foreground" data-testid="admin-boundary-counts-empty">
                {t("adminMemberQuotas.noPrivate")}
              </span>
            )}
            <div className="flex flex-wrap gap-2">
              {withEntries.map((m) => (
                <span
                  key={m.userId}
                  data-testid={`admin-member-private-${m.userId}`}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-11"
                >
                  <span className="font-medium">{m.displayName}</span>
                  <span className="text-muted-foreground">{t("adminMemberQuotas.privateCount", { count: m.itemCount })}</span>
                  {/* 这个徽标在**说明**约束，不是在执行它：响应体里结构上就没有内容字段。 */}
                  <Badge tone="neutral">{t("adminMemberQuotas.hidden")}</Badge>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-3" data-testid="admin-members-project-access">
            <div className="flex items-start gap-2">
              <ScrollText aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-12">
                {t("adminMemberQuotas.auditExplanation", { count: new Set((logs ?? []).map((l) => l.projectId)).size })}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1" data-testid="admin-members-access-logs">
            <span className="text-11 font-medium text-muted-foreground" data-testid="admin-members-my-access">
              {t("adminMemberQuotas.accessTitle")}
            </span>
            {logs === null && <span className="text-11 text-muted-foreground">{t("adminMemberQuotas.loading")}</span>}
            {logs !== null && logs.length === 0 && (
              <span className="text-11 text-muted-foreground" data-testid="admin-boundary-logs-empty">
                {t("adminMemberQuotas.noAccess")}
              </span>
            )}
            {(logs ?? []).map((log) => (
              <div
                key={log.logId}
                data-testid={`admin-access-log-${log.logId}`}
                className="flex flex-wrap items-center gap-2 rounded-sm border border-border-subtle bg-card px-2.5 py-1.5 text-11"
              >
                <FileClock aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{log.projectId}</span>
                <span className="font-mono text-10 text-muted-foreground">{log.objectRef}</span>
                <span className="ml-auto text-muted-foreground">{log.readAt}</span>
                <Badge tone="primary">{t("adminMemberQuotas.visible")}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
