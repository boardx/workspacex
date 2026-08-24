"use client";
import * as React from "react";
import { ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { rateMessage, type RatingVerdict } from "@/lib/live-message-rating";

/**
 * F176 —— AI 消息上的 👍/👎 评价控件（F68 契约 `rateMessage`；UC-3.6 R3 阶段一）。
 *
 * 落点就是 `contracts/skills/ui.md` 屏 F（`uc-3-6-feedback`）逐字描述的**采集侧**：
 * 「AI 消息下 `[👍 有用]` `[👎 待改进（可填理由）]`」。
 *
 * ## 三条它**不**做的事
 *
 *   ① **不传归因**。归因由服务端从 `agent_runs` 查——见 `live-message-rating.ts` 头注。
 *   ② **不做乐观更新**。点完先等服务端回，成功了才显示「已记录」。
 *      评价是要落库的账；先显示成功再发请求，一旦失败用户会以为自己已经评过了，
 *      而实际上没有——他不会再点第二次。
 *   ③ **不隐藏「未计入 skill 满意度」**。服务端回的 `attribution.skillVersionId === null`
 *      表示这条评价只计 agent 级（I-20）。契约注释逐字要求它「进数据质量报表」，
 *      而对评价的人来说，最起码要知道自己这一票没有落到某个 skill 上。
 *      ⚠ 这个判断**只从 attribution 推**，没有第二个字段——服务端也不发第二个字段。
 *
 * ## 为什么 👎 的理由是可选的
 *
 * 契约 `reason: z.string().nullable()`。强制填理由会把「我就是想标一下这条不好」
 * 变成一次要动脑子的表单，于是大多数人不点——采集侧的样本量本来就是满意度
 * 「样本不足」的成因。
 */
export function MessageRating({ messageId }: { messageId: string }) {
  const [submitted, setSubmitted] = React.useState<{
    verdict: RatingVerdict; attributedToSkill: boolean;
  } | null>(null);
  const [pendingDown, setPendingDown] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async (verdict: RatingVerdict, withReason: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const out = await rateMessage({ messageId, verdict, reason: withReason });
      setSubmitted({ verdict, attributedToSkill: out.attribution.skillVersionId !== null });
      setPendingDown(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground"
           data-testid="chat-message-rating-done" data-message-id={messageId}>
        <Check aria-hidden className="h-3 w-3 text-primary" />
        <span>{submitted.verdict === "up" ? "已记录：有用" : "已记录：待改进"}</span>
        {!submitted.attributedToSkill && (
          // I-20：只计 agent 级。说出来，而不是让这一票悄悄消失在满意度之外。
          <span data-testid="chat-message-rating-unattributed">
            · 这条未能归到具体 skill 版本，只计 agent 级，不计入任何 skill 的满意度
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid="chat-message-rating" data-message-id={messageId}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send("up", null)}
          data-testid="chat-message-rating-up"
          aria-label="有用"
          title="有用"
          className="inline-grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors duration-fast invisible hover:bg-muted hover:text-card-foreground focus-visible:visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:visible"
        >
          <ThumbsUp aria-hidden className="h-3 w-3" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPendingDown(true)}
          data-testid="chat-message-rating-down"
          aria-label="待改进"
          title="待改进（可填理由）"
          className="inline-grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors duration-fast invisible hover:bg-muted hover:text-card-foreground focus-visible:visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:visible"
        >
          <ThumbsDown aria-hidden className="h-3 w-3" />
        </button>
      </div>

      {pendingDown && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="chat-message-rating-reason">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="哪里待改进？（可不填）"
            aria-label="待改进的理由"
            data-testid="chat-message-rating-reason-input"
            className="h-6 min-w-0 flex-1 rounded border border-border-subtle bg-panel px-1.5 text-10"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("down", reason.trim() === "" ? null : reason.trim())}
            data-testid="chat-message-rating-reason-submit"
            className="rounded border border-border-subtle px-1.5 py-0.5 text-10 transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            提交
          </button>
        </div>
      )}

      {error && (
        <span className="text-10 text-muted-foreground" data-testid="chat-message-rating-error">
          评价没能记录（{error}）。它没有被保存，可以再试一次。
        </span>
      )}
    </div>
  );
}
