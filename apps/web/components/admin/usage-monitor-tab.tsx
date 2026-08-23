"use client";
import * as React from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  getUsageReport, listLimitEvents,
  type GetUsageReportOut, type ListLimitEventsOut, type UsageWindowKey,
} from "@/lib/live-org-admin";

/**
 * 用量监控 tab —— **F161 起真栈**（token-quota-and-usage delta）。
 *
 * ## 这个文件此前自己承认过什么
 *
 * 它的旧文件头逐字写着：「窗口切换只影响本地展示态（无后端），不真正拉取不同窗口的
 * 数据——mock 定死一份「本周」快照」。四个窗口按钮点起来数字纹丝不动，而那正是
 * 管理员最需要相信的一块屏。F161 把每个窗口变成一次真实聚合请求。
 *
 * ## 三处刻意与原型不同
 *
 * ① **矩阵的列不再写死**（原型是五个固定模型名）。列 = 窗口内真实出现过的模型，
 *    按用量降序；组织换了模型不会留下五个空列，也不会漏掉真正在用的那个。
 * ② **去掉了「额度用量%」那一列**。额度是**月度**的，而窗口可以是「最近 5 小时」——
 *    把 5 小时的用量除以月度额度，得到的百分比没有任何含义，却看起来非常像有含义。
 *    要看额度用量请去「成员配额」tab（那里的分母与分子同为本月）。
 * ③ **「近期限额事件」F162 起也是真的**：数据源 `limit_events` 那时才建起来。
 *    在它存在之前，这块屏保留着「尚未接入真实后端」提示而不是渲染一块「暂无事件」的
 *    空区——那会让「还没做」和「真的没发生过」在界面上长得一模一样。现在它有真来源了，
 *    空数组才第一次真的表示「本周期没有任何规则被触发」。
 */

/** 窗口枚举 → 界面标签。取值来自契约（单一事实源），标签在这里映射一次。 */
const WINDOW_LABEL: Record<UsageWindowKey, string> = {
  "5h": "最近 5 小时",
  today: "今日",
  week: "本周",
  month: "本月",
};
const WINDOWS = Object.keys(WINDOW_LABEL) as UsageWindowKey[];

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return n.toLocaleString();
}

/** 触顶动作的中文标签。与 `limit-rules-live.tsx` 的同一份映射同源于契约枚举。 */
const ACTION_LABEL: Record<string, string> = {
  warn: "预警", degrade: "已降级", block: "已拒绝", require_approval: "待批准",
};

export function UsageMonitorTab() {
  const session = useOptionalSession()?.session ?? null;
  const orgId = session?.currentOrgId ?? null;

  const [windowKey, setWindowKey] = React.useState<UsageWindowKey>("week");
  const [data, setData] = React.useState<GetUsageReportOut | null>(null);
  const [events, setEvents] = React.useState<ListLimitEventsOut["events"] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setError(null);
    setData(null);
    void (async () => {
      try {
        const out = await getUsageReport(orgId, windowKey);
        if (!cancelled) setData(out);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
        }
      }
    })();
    return () => { cancelled = true; };
    // windowKey 进依赖：换窗口 = 换一次请求，这就是本 feature 的全部主张。
  }, [orgId, windowKey]);

  // 限额事件不随统计窗口变：它是「近期发生过什么」，不是「这个窗口里的用量」。
  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const out = await listLimitEvents(orgId);
        if (!cancelled) setEvents(out.events);
      } catch {
        // 事件读失败不该把整屏用量拖成错误态——它是这一屏的附属块。
        if (!cancelled) setEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const empty = data !== null && data.callCount === 0;

  return (
    <div className="flex flex-col gap-5" data-testid="admin-usage-tab">
      {/* 统计窗口切换 */}
      <div className="flex flex-wrap items-center gap-2" data-testid="admin-usage-window">
        <span className="text-11 text-muted-foreground">统计窗口</span>
        <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {WINDOWS.map((w) => (
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
              {WINDOW_LABEL[w]}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-10 text-muted-foreground">
          {data ? `${WINDOW_LABEL[data.window]} · 单位 token` : "读取中…"}
        </span>
      </div>

      {!orgId && <p className="text-12 text-muted-foreground">尚未选择组织。</p>}

      {error && (
        <Card data-testid="admin-usage-load-failed">
          <CardContent className="p-3 text-12 text-destructive">
            用量数据读取失败：{error}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* 四张概览卡 —— 数值来自本次窗口的聚合 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="admin-usage-stats">
            <Card data-testid="admin-usage-stat-total">
              <CardContent className="flex flex-col gap-1.5 pt-3">
                <span className="text-11 text-muted-foreground">总用量</span>
                <span className="font-serif text-24 font-medium">{fmt(data.totalTokens)}</span>
                <span className="font-mono text-10 text-muted-foreground">{WINDOW_LABEL[data.window]}</span>
              </CardContent>
            </Card>
            <Card data-testid="admin-usage-stat-calls">
              <CardContent className="flex flex-col gap-1.5 pt-3">
                <span className="text-11 text-muted-foreground">调用次数</span>
                <span className="font-serif text-24 font-medium">{data.callCount.toLocaleString()}</span>
                <span className="font-mono text-10 text-muted-foreground">含失败调用</span>
              </CardContent>
            </Card>
            <Card data-testid="admin-usage-stat-failed">
              <CardContent className="flex flex-col gap-1.5 pt-3">
                <span className="text-11 text-muted-foreground">其中失败</span>
                <span className={`font-serif text-24 font-medium ${data.failedCallCount > 0 ? "text-warning" : ""}`}>
                  {data.failedCallCount.toLocaleString()}
                </span>
                <span className="font-mono text-10 text-muted-foreground">失败不计 token，但计一次调用</span>
              </CardContent>
            </Card>
            <Card data-testid="admin-usage-stat-active">
              <CardContent className="flex flex-col gap-1.5 pt-3">
                <span className="text-11 text-muted-foreground">活跃成员</span>
                <span className="font-serif text-24 font-medium">{data.activeMemberCount}</span>
                <span className="font-mono text-10 text-muted-foreground">窗口内有过调用的人</span>
              </CardContent>
            </Card>
          </div>

          {/* 按人 × 模型矩阵 */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <BarChart3 aria-hidden className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-14 font-semibold">按人 × 模型</h2>
              <span className="ml-auto text-10 text-muted-foreground">
                额度用量在「成员配额」tab（额度按月结算，与这里的窗口不同口径）
              </span>
            </div>
            <Card>
              <CardContent className="overflow-x-auto p-0">
                {empty ? (
                  <p className="p-4 text-12 text-muted-foreground" data-testid="admin-usage-empty">
                    {WINDOW_LABEL[data.window]}内还没有任何模型调用。
                  </p>
                ) : (
                  <Table className="w-full min-w-[560px] border-collapse text-11" data-testid="admin-usage-matrix">
                    <TableHeader>
                      <TableRow className="border-b border-border bg-panel text-11 text-muted-foreground">
                        <TableHead className="px-3 py-2 text-left font-medium">成员</TableHead>
                        {data.models.map((m) => (
                          <TableHead key={m} className="px-2 py-2 text-right font-mono font-medium">{m}</TableHead>
                        ))}
                        <TableHead className="px-2 py-2 text-right font-medium">合计</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((r) => (
                        <TableRow
                          key={r.userId}
                          className="border-b border-border-subtle"
                          data-testid={`admin-usage-matrix-row-${r.userId}`}
                        >
                          <TableCell className="px-3 py-2 font-medium">{r.displayName}</TableCell>
                          {r.perModel.map((v, i) => (
                            <TableCell key={data.models[i]} className="px-2 py-2 text-right font-mono text-muted-foreground">
                              {fmt(v)}
                            </TableCell>
                          ))}
                          <TableCell className="px-2 py-2 text-right font-mono font-medium">{fmt(r.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </section>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card data-testid="admin-usage-model-distribution">
              <CardContent className="flex flex-col gap-2.5 pt-4">
                <span className="text-12 font-medium">按模型分布</span>
                {data.distribution.length === 0 && (
                  <span className="text-11 text-muted-foreground">窗口内没有调用。</span>
                )}
                {data.distribution.map((m) => {
                  const pct = Math.round(m.share * 100);
                  return (
                    <div key={m.modelId} data-testid={`admin-usage-distribution-${m.modelId}`}>
                      <div className="mb-1 flex items-center gap-2 text-11">
                        <span className="flex-1 truncate font-mono">{m.modelId}</span>
                        <span className="font-mono text-10">{pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card data-testid="admin-usage-recent-events">
              <CardContent className="flex flex-col gap-2.5 pt-4">
                <span className="text-12 font-medium">近期限额事件</span>
                {events === null && <span className="text-11 text-muted-foreground">读取中…</span>}
                {events !== null && events.length === 0 && (
                  <span className="text-11 text-muted-foreground" data-testid="admin-usage-events-empty">
                    近期没有任何限额规则被触发。
                  </span>
                )}
                {(events ?? []).map((ev) => (
                  <div key={ev.eventId} className="flex items-start gap-2"
                    data-testid={`admin-usage-event-${ev.eventId}`}>
                    <Badge tone={ev.actionTaken === "block" ? "danger" : ev.actionTaken === "warn" ? "warning" : "primary"}>
                      {ACTION_LABEL[ev.actionTaken]}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-11 leading-relaxed">
                        {ev.subjectRef} 触顶：观测 {fmt(ev.observedTokens)} / 上限 {fmt(ev.thresholdTokens)}
                      </p>
                      <p className="font-mono text-9 text-muted-foreground">
                        {ev.occurredAt}
                        {/* 规则已删时 ruleId 是空串——事件仍然是真的，如实说「规则已删除」 */}
                        {ev.ruleId === "" ? " · 规则已删除" : ` · 规则 ${ev.ruleId.slice(0, 8)}`}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
