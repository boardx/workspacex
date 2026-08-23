"use client";
import * as React from "react";
import { ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAgentRunContextSnapshot, type AgentRunContextSnapshotView } from "@/lib/agent-run";

/**
 * context-engine 可用性补口——组装出的 L1/L2/L3/F190 四层上下文此前对用户**完全不可见**
 * （`chat-live-message-panel.tsx` 自己的既有注释写着"citations 的写入路径目前不存在"）；
 * F157 的可审计快照落地时只接了写，从没有任何 HTTP 端点或 UI 消费过它。本组件是这条
 * 可用性缺口的最小补丁：每条 AI 消息自己身上挂一枚可展开的徽标，读的是 F157 已经在
 * `execute-run.ts` 组装完成那一刻写下的真实快照（`GET /agent-runs/:runId/context-
 * snapshot`），不新造任何组装逻辑或采集机制。
 *
 * ## 惰性到"进入视口才拉取" + 失败静默降级
 *
 * 与 `message-thinking-chain.tsx` 同一套既有纪律（那份文件头注已经把 N+1 与缓存新鲜度
 * 两个坑写清楚了，这里原样照抄，不重新踩一遍）：`IntersectionObserver` 惰性拉取、
 * 不做跨组件缓存、请求失败不渲染任何东西（这是消息正文之外的锦上添花信息，缺了不该
 * 让消息本身看起来像出了问题）。
 *
 * ## 快照为 `null` 时同样不渲染
 *
 * `null` 是"这个 run 你能看，只是还没有快照"（早于 F157 上线，或组装从未走到写快照
 * 那一步）——诚实地不展示，不是空壳占位。
 */
function statusLabel(status: "ok" | "degraded" | "not_configured"): string {
  if (status === "ok") return "正常";
  if (status === "degraded") return "降级";
  return "未启用";
}

function statusTone(status: "ok" | "degraded" | "not_configured"): "outline" | "warning" {
  return status === "degraded" ? "warning" : "outline";
}

export function ContextSnapshotBadge({ snapshot }: { snapshot: AgentRunContextSnapshotView }) {
  const [open, setOpen] = React.useState(false);
  if (snapshot === null) return null;

  // UI 评分 2026-08-23 第 10 项点名：「L1 0 条 · L2 正常 · L3 命中 0 · 工具轨迹 0 轮
  // 是内部术语直出给终端用户」。收起态改说人话（内部分层术语收进展开详情——
  // 展开面板里的 L1/L2/L3 字段名保留，那是给想深究的人看的，两层受众不同）。
  const summary = [
    `参考了 ${snapshot.l1MessageCount} 条近期消息`,
    snapshot.l2Status === "degraded" ? "历史摘要降级" : "历史摘要正常",
    snapshot.l3Status === "not_configured" ? null : `知识检索命中 ${snapshot.l3HitCount}`,
    snapshot.toolTraceStatus === "not_configured" ? null : `工具记录 ${snapshot.toolTraceRunCount} 轮`,
  ].filter((part): part is string => part !== null).join(" · ");

  return (
    <div className="flex flex-col gap-1" data-testid="context-snapshot-badge">
      <button
        type="button"
        data-testid="context-snapshot-toggle"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-fit items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-10 text-muted-foreground transition-colors duration-200 hover:bg-muted"
      >
        <Info className="h-3 w-3" aria-hidden />
        <span data-testid="context-snapshot-summary">{summary}</span>
        <ChevronRight aria-hidden className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <dl
          data-testid="context-snapshot-detail"
          className="flex flex-col gap-1 rounded-lg border border-border/60 bg-panel px-3 py-2 text-10 text-muted-foreground"
        >
          <div className="flex items-center justify-between gap-2">
            <dt>L1 近端原文</dt>
            <dd>{snapshot.l1MessageCount} 条保留在近端窗口</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>L2 滚动摘要</dt>
            <dd>
              <Badge tone={statusTone(snapshot.l2Status)}>{statusLabel(snapshot.l2Status)}</Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>L3 文件式检索</dt>
            <dd className="flex flex-wrap items-center justify-end gap-1">
              <Badge tone={statusTone(snapshot.l3Status)}>{statusLabel(snapshot.l3Status)}</Badge>
              {snapshot.l3HitCount > 0 ? <span>命中 {snapshot.l3HitCount} 条</span> : null}
              {snapshot.l3Sources.map((source) => (
                <Badge key={source} tone="outline" data-testid={`context-snapshot-l3-source-${source}`}>
                  {source}
                </Badge>
              ))}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>F190 工具调用轨迹</dt>
            <dd>
              <Badge tone={statusTone(snapshot.toolTraceStatus)}>{statusLabel(snapshot.toolTraceStatus)}</Badge>
              {snapshot.toolTraceRunCount > 0
                ? ` 回喂 ${snapshot.toolTraceRunCount} 轮 · ${snapshot.toolTraceStepCount} 条调用`
                : null}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>估算 token</dt>
            <dd>{snapshot.estimatedTokens}（保守字符预算换算，非真实计费数字）</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

/**
 * ⚠ 有意**不**照抄 `message-thinking-chain.tsx` 的 `IntersectionObserver` 惰性拉取
 * （2026-08-19 e2e 实测发现）：那份惰性拉取本身此前从未被任何浏览器 e2e 真正走过
 * （既有用例只测过"当前活跃 run"的 `AgentToolChain`，从没有一条用例断言过某条
 * *持久消息*自己的思考链渲染出来过），本组件用同样的写法接入真栈 e2e 后，在一条
 * 30+ 条历史消息、发送后自动滚到底的长线程里稳定复现"惰性拉取从未触发、徽标永远
 * 不出现"——`root: null` 的 viewport 相交判定在这类"消息列表自身是一个裁剪滚动
 * 容器"的布局下不可靠。挂载即拉取会让很长的历史多打几个请求（`getAgentRunContext
 * Snapshot` 只读一行、无重计算），拿这一点性能换回真实可用（可用性正是这个组件
 * 存在的全部意义），是这里刻意的取舍，不是疏漏。
 */
export function MessageContextSnapshot({
  agentRunId,
  bearer,
}: {
  agentRunId: string | null;
  bearer: string;
}) {
  const [snapshot, setSnapshot] = React.useState<AgentRunContextSnapshotView | undefined>(undefined);

  React.useEffect(() => {
    if (!agentRunId) return;
    let cancelled = false;
    void getAgentRunContextSnapshot(agentRunId, bearer)
      .then((result) => {
        if (!cancelled) setSnapshot(result);
      })
      .catch(() => {
        // 静默降级（见文件头注释）——不设错误态，消息正文不受影响。
      });
    return () => {
      cancelled = true;
    };
  }, [agentRunId, bearer]);

  if (!agentRunId || snapshot === undefined) return null;
  return <ContextSnapshotBadge snapshot={snapshot} />;
}
