"use client";
import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decideAgentRun, type AgentRunView } from "@/lib/agent-run";

/**
 * agent-approval-panel（DA-07c，#1749，rubric D6 人在环的前端半边）—— 活体生产组件。
 *
 * run 停在 awaiting_approval（引擎 interrupt_on，DA-07；传输链 DA-07b）时渲染：
 * 待批工具名 + 参数摘要 + 批准/拒绝两钮。裁决走 POST /agent-runs/:runId/decision，
 * 之后**不在本地预测结果**——既有的 run 轮询是唯一权威状态源（approve 后 run 回
 * queued/running，轮询自然跟上；reject 后落 failed，状态条如实变红）。
 *
 * 409（竞态输了：已被别人裁决/已终态）如实展示服务端话术，不假装自己的决定生效
 * ——与 decideAgentRun 客户端注释同一条纪律。
 *
 * 样式对齐 agent-plan-panel/agent-tool-chain 的卡片语言（同层级的过程可见性信息，
 * 不引入风格孤岛）。危险语义用 warning 边框强调：这是全界面唯一一个「不点它
 * run 就永远停着」的块，允许比兄弟组件重半档。
 */
export function AgentApprovalPanel({
  view,
  sessionToken,
  onDecided,
}: {
  view: AgentRunView;
  sessionToken?: string;
  onDecided?: () => void;
}) {
  const [inFlight, setInFlight] = React.useState<"approve" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (view.status !== "awaiting_approval" || view.pendingApproval == null) return null;
  const pending = view.pendingApproval;

  const decide = async (decision: "approve" | "reject") => {
    setInFlight(decision);
    setError(null);
    try {
      await decideAgentRun(view.runId, decision, sessionToken);
      onDecided?.();
    } catch (e) {
      // 409 = 竞态输了（已被别人裁决/已终态）；其余照实报。绝不本地假装成功。
      setError(e instanceof Error ? e.message : "裁决提交失败");
    } finally {
      setInFlight(null);
    }
  };

  return (
    <div
      className="rounded-md border border-warning/40 bg-card px-2.5 py-2"
      data-testid="agent-approval-panel"
      data-pending-tool={pending.toolName}
    >
      <div className="mb-1 flex items-center gap-1.5 text-11 font-medium">
        <ShieldAlert aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />
        <span>等待你的批准：{pending.toolName}</span>
      </div>
      {pending.argsSummary !== null && (
        <pre
          className="mb-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-10 text-muted-foreground"
          data-testid="agent-approval-args"
        >
          {pending.argsSummary}
        </pre>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={inFlight !== null}
          onClick={() => void decide("approve")}
          data-testid="agent-approval-approve"
        >
          {inFlight === "approve" ? "批准中…" : "批准并继续"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={inFlight !== null}
          onClick={() => void decide("reject")}
          data-testid="agent-approval-reject"
        >
          {inFlight === "reject" ? "拒绝中…" : "拒绝"}
        </Button>
      </div>
      {error !== null && (
        <p className="mt-1 text-10 text-destructive" data-testid="agent-approval-error">
          {error}
        </p>
      )}
    </div>
  );
}
