"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  createEmailInvitations, resendInvitation, describeInvitationFailure, parseEmailList, sendErrorText,
  EMAIL_OUTCOME_LABEL, MAX_EMAILS_PER_REQUEST, INVITATION_TTL_DAYS,
  type EmailInvitationResult, type EmailInvitationOutcome,
} from "@/lib/live-project-invitations";

const OUTCOME_TONE: Record<EmailInvitationOutcome, "success" | "danger" | "attention" | "neutral"> = {
  sent: "success",
  send_failed: "danger",
  already_pending: "attention",
  already_member: "neutral",
  invalid_email: "danger",
};

/**
 * 「按邮箱」：一次最多 20 个邮箱，逐个给出结果。发送失败对邀请人**可见**：失败原因（人话）+ 「重发」。
 * 重发只改那一行的结果，不整批重来。
 */
export function ProjectInviteEmailForm({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<EmailInvitationResult[] | null>(null);
  const [resending, setResending] = React.useState<number | null>(null);
  const [rowError, setRowError] = React.useState<Record<number, string>>({});

  const emails = parseEmailList(text);
  const tooMany = emails.length > MAX_EMAILS_PER_REQUEST;

  async function submit() {
    if (emails.length === 0 || tooMany) return;
    setBusy(true); setError(null); setRowError({});
    try {
      const out = await createEmailInvitations(projectId, emails);
      setResults(out.invitations);
      setText("");
      onChanged();
    } catch (e) {
      setError(describeInvitationFailure(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend(index: number, invitationId: string) {
    setResending(index);
    setRowError((r) => { const { [index]: _drop, ...rest } = r; return rest; });
    try {
      const out = await resendInvitation(projectId, invitationId);
      setResults((prev) => prev && prev.map((r, i) => (i === index ? { ...r, outcome: out.outcome, lastSendError: out.lastSendError } : r)));
      onChanged();
    } catch (e) {
      setRowError((r) => ({ ...r, [index]: describeInvitationFailure(e) }));
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="project-invite-email-form">
      <label className="flex flex-col gap-1 text-10 text-muted-foreground">
        <span>邮箱（一行一个，或用逗号分隔，最多 {MAX_EMAILS_PER_REQUEST} 个）</span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={"name@example.com\nanother@example.com"}
          rows={3}
          disabled={busy}
          data-testid="project-invite-email-input"
        />
      </label>
      <p className="text-10 text-muted-foreground">
        对方会收到一封邮件，{INVITATION_TTL_DAYS} 天内点开即可加入项目；没有账号的人会先设置姓名和密码。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy || emails.length === 0 || tooMany}
          onClick={() => void submit()} data-testid="project-invite-email-submit">
          {busy ? "发送中…" : emails.length > 0 ? `发送邀请（${emails.length}）` : "发送邀请"}
        </Button>
        {tooMany && (
          <span className="text-10 text-destructive" data-testid="project-invite-email-toomany">
            一次最多邀请 {MAX_EMAILS_PER_REQUEST} 个邮箱，请删掉 {emails.length - MAX_EMAILS_PER_REQUEST} 个。
          </span>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid="project-invite-email-error">{error}</p>
      )}
      {results !== null && (
        <ul className="divide-y divide-border rounded-control border border-border" data-testid="project-invite-email-results">
          {results.map((r, i) => {
            const reason = r.outcome === "send_failed" ? sendErrorText(r.lastSendError) : null;
            return (
              <li key={`${r.email}-${i}`} className="flex flex-col gap-1 px-3 py-2" data-testid={`project-invite-email-result-${i}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 break-all text-12">{r.email}</span>
                  <Badge tone={OUTCOME_TONE[r.outcome]} data-testid={`project-invite-email-outcome-${i}`}>
                    {EMAIL_OUTCOME_LABEL[r.outcome]}
                  </Badge>
                  {r.outcome === "send_failed" && r.invitationId !== null && (
                    <Button size="xs" variant="outline" disabled={resending === i}
                      onClick={() => void resend(i, r.invitationId as string)}
                      data-testid={`project-invite-email-resend-${i}`}>
                      {resending === i ? "重发中…" : "重发"}
                    </Button>
                  )}
                </div>
                {reason !== null && (
                  <p className="text-10 text-destructive" data-testid={`project-invite-email-reason-${i}`}>{reason}</p>
                )}
                {r.outcome === "already_pending" && (
                  <p className="text-10 text-muted-foreground">这个邮箱已经邀请过了，可在下方「待处理邀请」里重发。</p>
                )}
                {rowError[i] !== undefined && (
                  <p role="alert" className="text-10 text-destructive" data-testid={`project-invite-email-rowerror-${i}`}>{rowError[i]}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
