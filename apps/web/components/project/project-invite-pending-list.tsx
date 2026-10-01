"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "./parts";
import { humanTime } from "@/lib/human-time";
import {
  resendInvitation, revokeInvitation, describeInvitationFailure, sendErrorText,
  INVITATION_STATUS_LABEL, MAX_SENDS_PER_INVITATION, RESEND_COOLDOWN_SECONDS, projectInvitationReasonText,
  type InvitationListItem, type InvitationStatus,
} from "@/lib/live-project-invitations";

const STATUS_TONE: Record<InvitationStatus, "attention" | "success" | "neutral" | "outline"> = {
  pending: "attention",
  accepted: "success",
  expired: "neutral",
  revoked: "outline",
};

/** 「重发」按钮当前能不能点；不能点时给出原因（人话），不给一个哑掉的按钮。 */
export function resendAvailability(item: InvitationListItem, now: number): { ok: true; remaining: number } | { ok: false; reason: string } {
  if (item.kind !== "email") return { ok: false, reason: "链接邀请不能重发；需要新链接请在「按链接」里重置。" };
  if (item.status !== "pending") return { ok: false, reason: "只有待接受的邀请可以重发。" };
  const remaining = Math.max(0, MAX_SENDS_PER_INVITATION - item.sendAttempts);
  if (remaining === 0) return { ok: false, reason: projectInvitationReasonText("RESEND_LIMIT_REACHED") };
  if (!item.canResend) return { ok: false, reason: "这条邀请现在不能重发。" };
  if (item.lastSentAt !== null) {
    const wait = Math.ceil((Date.parse(item.lastSentAt) + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000);
    if (wait > 0) return { ok: false, reason: `刚刚发送过，请 ${wait} 秒后再重发。` };
  }
  return { ok: true, remaining };
}

/**
 * 「待处理邀请」：邀请的完整历史（新的在前）。失败对邀请人可见；重发 / 撤销各自行内确认，
 * 每次写成功后通知上层重新拉列表（本仓一贯纪律：不在本地 patch）。
 */
export function ProjectInvitePendingList({ projectId, items, loadError, onChanged, onRetry }: {
  projectId: string;
  items: InvitationListItem[] | undefined;
  loadError: string | null;
  onChanged: () => void;
  onRetry: () => void;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [rowNote, setRowNote] = React.useState<Record<string, string>>({});

  // 只在有行处于冷却期时走表，其余时候不占定时器。
  const cooling = (items ?? []).some((i) =>
    i.lastSentAt !== null && Date.parse(i.lastSentAt) + RESEND_COOLDOWN_SECONDS * 1000 > now);
  React.useEffect(() => {
    if (!cooling) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooling]);

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id);
    setRowError((r) => { const { [id]: _a, ...rest } = r; return rest; });
    setRowNote((r) => { const { [id]: _a, ...rest } = r; return rest; });
    try {
      await action();
    } catch (e) {
      setRowError((r) => ({ ...r, [id]: describeInvitationFailure(e) }));
    } finally {
      setBusyId(null);
    }
  }

  const resend = (item: InvitationListItem) => run(item.invitationId, async () => {
    const out = await resendInvitation(projectId, item.invitationId);
    setNow(Date.now());
    setRowNote((r) => ({
      ...r,
      [item.invitationId]: out.outcome === "sent" ? `已重新发送，还可重发 ${out.remainingSends} 次。` : (sendErrorText(out.lastSendError) ?? "邮件没有发出去，请稍后重发。"),
    }));
    onChanged();
  });

  const revoke = (item: InvitationListItem) => run(item.invitationId, async () => {
    await revokeInvitation(projectId, item.invitationId);
    setConfirmId(null);
    onChanged();
  });

  return (
    <section data-testid="project-invite-pending">
      <SectionTitle meta="发出去的邀请都在这里；邮件没送到时可以重发">待处理邀请</SectionTitle>
      <Card>
        {loadError !== null ? (
          <div className="flex flex-wrap items-center gap-2 p-4">
            <p className="text-11 text-destructive" data-testid="project-invite-pending-error">{loadError}</p>
            <Button size="xs" variant="outline" onClick={onRetry} data-testid="project-invite-pending-retry">重试</Button>
          </div>
        ) : items === undefined ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-invite-pending-loading">读取邀请中…</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-invite-pending-empty">还没有发出过邀请。</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="project-invite-pending-list">
            {items.map((item) => {
              const id = item.invitationId;
              const avail = resendAvailability(item, now);
              const failure = item.status === "pending" ? sendErrorText(item.lastSendError) : null;
              const canRevoke = item.status === "pending";
              return (
                <li key={id} className="flex flex-col gap-1.5 px-3.5 py-3" data-testid={`project-invite-item-${id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-all text-12 font-medium" data-testid={`project-invite-item-target-${id}`}>
                      {item.kind === "email" ? item.email : "链接"}
                    </span>
                    <Badge tone="outline">{item.kind === "email" ? "邮箱邀请" : "链接邀请"}</Badge>
                    <Badge tone={STATUS_TONE[item.status]} data-testid={`project-invite-item-status-${id}`}>
                      {INVITATION_STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                  <p className="text-10 text-muted-foreground" data-testid={`project-invite-item-meta-${id}`}>
                    {item.invitedByName} 邀请
                    {item.kind === "email" && (
                      <> · {item.lastSentAt !== null ? `上次发送 ${humanTime(item.lastSentAt, now)}` : "还没有发出"} · 已发送 {item.sendAttempts} 次</>
                    )}
                  </p>
                  {failure !== null && (
                    <p className="text-10 text-destructive" data-testid={`project-invite-item-failure-${id}`}>{failure}</p>
                  )}
                  {(item.kind === "email" || canRevoke) && item.status === "pending" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {item.kind === "email" && (
                        <>
                          <Button size="xs" variant="outline" disabled={busyId === id || !avail.ok}
                            onClick={() => void resend(item)} data-testid={`project-invite-item-resend-${id}`}>
                            {busyId === id ? "处理中…" : "重发"}
                          </Button>
                          {avail.ok ? (
                            <span className="text-10 text-muted-foreground" data-testid={`project-invite-item-remaining-${id}`}>还可重发 {avail.remaining} 次</span>
                          ) : (
                            <span className="text-10 text-muted-foreground" data-testid={`project-invite-item-resend-reason-${id}`}>{avail.reason}</span>
                          )}
                        </>
                      )}
                      {confirmId === id ? (
                        <span className="flex flex-wrap items-center gap-2" data-testid={`project-invite-item-revoke-confirm-${id}`}>
                          <span className="text-10 text-destructive">撤销后对方的邀请立刻失效，确定吗？</span>
                          <Button size="xs" variant="destructive" disabled={busyId === id} onClick={() => void revoke(item)}
                            data-testid={`project-invite-item-revoke-yes-${id}`}>确定撤销</Button>
                          <Button size="xs" variant="ghost" disabled={busyId === id} onClick={() => setConfirmId(null)}
                            data-testid={`project-invite-item-revoke-no-${id}`}>取消</Button>
                        </span>
                      ) : (
                        <Button size="xs" variant="ghost" disabled={busyId === id} onClick={() => setConfirmId(id)}
                          data-testid={`project-invite-item-revoke-${id}`}>撤销</Button>
                      )}
                    </div>
                  )}
                  {rowNote[id] !== undefined && (
                    <p className="text-10 text-muted-foreground" data-testid={`project-invite-item-note-${id}`}>{rowNote[id]}</p>
                  )}
                  {rowError[id] !== undefined && (
                    <p role="alert" className="text-10 text-destructive" data-testid={`project-invite-item-error-${id}`}>{rowError[id]}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
