"use client";
import * as React from "react";
import { Pencil, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decideAgentRun, type AgentRunView } from "@/lib/agent-run";

/**
 * agent-approval-panel（DA-07c，#1749，rubric D6 人在环的前端半边；UX-9 D4 补 edit
 * 分支，gap 清单第 3 条）—— 活体生产组件。
 *
 * run 停在 awaiting_tool_permission（引擎 interrupt_on，DA-07；传输链 DA-07b）时渲染：
 * 待批工具名 + 参数（默认只读摘要，点「编辑参数」切换成可编辑 JSON 文本域）+
 * 批准/编辑并批准/拒绝三钮。裁决走 POST /agent-runs/:runId/decision，之后
 * **不在本地预测结果**——既有的 run 轮询是唯一权威状态源（approve/edit 后 run 回
 * queued/running，轮询自然跟上；reject 后落 failed，状态条如实变红）。
 *
 * 409（竞态输了：已被别人裁决/已终态）如实展示服务端话术，不假装自己的决定生效
 * ——与 decideAgentRun 客户端注释同一条纪律。
 *
 * edit 校验纪律：`editedArgs` 必须是合法 JSON **对象**（契约要求「完整参数对象，
 * 不是 patch」）。文本域内容解析失败或不是对象时，「编辑并批准」按钮禁用并给出
 * 就地错误文案——绝不把非法 JSON 提交给服务端让 400 来兜底，用户体验上先挡一道。
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
  const [inFlight, setInFlight] = React.useState<"approve" | "edit" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const pending = view.pendingApproval;

  // draft 只在「首次进入编辑态」时用当前 argsSummary 播种；用户输入后不再被外部状态覆盖。
  const startEditing = () => {
    setDraft(pending?.argsSummary ?? "{}");
    setError(null);
    setEditing(true);
  };

  if (view.status !== "awaiting_tool_permission" || pending == null) return null;

  const parsedDraft = ((): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
    try {
      const value: unknown = JSON.parse(draft);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ok: false, message: "editedArgs 必须是 JSON 对象（不能是数组或原始值）" };
      }
      return { ok: true, value: value as Record<string, unknown> };
    } catch {
      return { ok: false, message: "不是合法 JSON，请修正后再提交" };
    }
  })();

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

  const decideEdit = async () => {
    if (!parsedDraft.ok) return; // 按钮已 disabled，双保险不提交非法 JSON。
    setInFlight("edit");
    setError(null);
    try {
      await decideAgentRun(view.runId, "edit", parsedDraft.value, sessionToken);
      setEditing(false);
      onDecided?.();
    } catch (e) {
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
      {!editing && pending.argsSummary !== null && (
        <pre
          className="mb-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-10 text-muted-foreground"
          data-testid="agent-approval-args"
        >
          {pending.argsSummary}
        </pre>
      )}
      {editing && (
        <div className="mb-1.5">
          <textarea
            className="h-32 w-full resize-y rounded border border-input bg-muted px-2 py-1 font-mono text-10 text-foreground"
            data-testid="agent-approval-edit-textarea"
            value={draft}
            disabled={inFlight !== null}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          {!parsedDraft.ok && (
            <p className="mt-1 text-10 text-destructive" data-testid="agent-approval-edit-json-error">
              {parsedDraft.message}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        {!editing && (
          <>
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
              onClick={startEditing}
              data-testid="agent-approval-start-edit"
            >
              <Pencil aria-hidden className="h-3 w-3" />
              编辑参数
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
          </>
        )}
        {editing && (
          <>
            <Button
              size="sm"
              disabled={inFlight !== null || !parsedDraft.ok}
              onClick={() => void decideEdit()}
              data-testid="agent-approval-edit-submit"
            >
              {inFlight === "edit" ? "提交中…" : "编辑并批准"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={inFlight !== null}
              onClick={() => setEditing(false)}
              data-testid="agent-approval-edit-cancel"
            >
              取消
            </Button>
          </>
        )}
      </div>
      {error !== null && (
        <p className="mt-1 text-10 text-destructive" data-testid="agent-approval-error">
          {error}
        </p>
      )}
    </div>
  );
}
