"use client";
import * as React from "react";
import { EyeOff, ScrollText, FileClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
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
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [counts, setCounts] = React.useState<
    { userId: string; displayName: string; itemCount: number }[] | null
  >(null);
  const [logs, setLogs] = React.useState<ListMyAccessLogOut["entries"] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
          setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
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
        <h2 className="text-14 font-semibold">你作为管理员看不到什么</h2>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-12 text-muted-foreground">
            这不是缺失功能，是产品的硬约束。个人层是三层记忆里唯一对管理员封闭的一层——顾问敢把半成品判断写进系统，
            前提是这一层<strong className="text-background-foreground">组织管理员看不到、agent 也读不到</strong>。
          </p>

          <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3" data-testid="admin-members-private-counts">
            <span className="text-12 font-medium">个人层 · 只有计数（内容不可见、不可搜索、不可导出、不进 AI 检索）</span>
            {error && (
              <span className="text-11 text-destructive" data-testid="admin-boundary-counts-failed">
                个人层计数读取失败：{error}
              </span>
            )}
            {!error && counts === null && <span className="text-11 text-muted-foreground">读取中…</span>}
            {!error && counts !== null && withEntries.length === 0 && (
              <span className="text-11 text-muted-foreground" data-testid="admin-boundary-counts-empty">
                组织里目前没有人写过个人层条目。
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
                  <span className="text-muted-foreground">私有条目 {m.itemCount} 条</span>
                  {/* 这个徽标在**说明**约束，不是在执行它：响应体里结构上就没有内容字段。 */}
                  <Badge tone="neutral">内容不可见</Badge>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-3" data-testid="admin-members-project-access">
            <div className="flex items-start gap-2">
              <ScrollText aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-12">
                出于审计目的你可以读项目内容，但<strong className="text-background-foreground">每次访问都会写入审计日志，并对项目负责人可见</strong>。
                {/* 「访问过几个项目」也是真数：按留痕里的 projectId 去重，不是一个写死的数字。 */}
                本月你访问过 {new Set((logs ?? []).map((l) => l.projectId)).size} 个项目。
                「升到项目层」是获取内容的唯一路径——不存在申请、提权、临时授权等旁路。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1" data-testid="admin-members-access-logs">
            <span className="text-11 font-medium text-muted-foreground" data-testid="admin-members-my-access">
              我的项目层访问（每条都对该项目负责人可见）
            </span>
            {logs === null && <span className="text-11 text-muted-foreground">读取中…</span>}
            {logs !== null && logs.length === 0 && (
              <span className="text-11 text-muted-foreground" data-testid="admin-boundary-logs-empty">
                你还没有读过任何项目内容。
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
                <Badge tone="primary">对负责人可见</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
