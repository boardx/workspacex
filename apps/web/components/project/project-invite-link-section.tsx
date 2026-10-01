"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  issueInviteLink, describeInvitationFailure, formatInviteDeadline, INVITATION_TTL_DAYS,
  type InvitationListItem, type IssueInviteLinkOut,
} from "@/lib/live-project-invitations";

/**
 * 「按链接」：生成 / 复制 / 重置。链接明文只在签发那一次响应里出现，所以页面刷新后只能告诉负责人
 * 「已有一条有效链接」，要新链接就重置。
 */
export function ProjectInviteLinkSection({ projectId, existing, onChanged }: {
  projectId: string;
  /** 列表里现存的待接受链接邀请（用来判断是「生成」还是「重置」）。 */
  existing: InvitationListItem | null;
  onChanged: () => void;
}) {
  const [link, setLink] = React.useState<IssueInviteLinkOut | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");

  const hasLink = link !== null || existing !== null;
  const expiresAt = link?.expiresAt ?? existing?.expiresAt ?? null;

  async function issue() {
    setBusy(true); setError(null); setConfirming(false); setCopyState("idle");
    try {
      setLink(await issueInviteLink(projectId));
      onChanged();
    } catch (e) {
      setError(describeInvitationFailure(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.inviteUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="project-invite-url-section">
      <p className="text-11 leading-relaxed text-muted-foreground" data-testid="project-invite-url-warning">
        拿到链接的人都能加入这个项目，也会成为这个组织的成员，直到链接过期（{INVITATION_TTL_DAYS} 天）或被重置。
        只发给你信任的人。
      </p>

      {!hasLink && (
        <div>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void issue()} data-testid="project-invite-url-generate">
            {busy ? "生成中…" : "生成邀请链接"}
          </Button>
        </div>
      )}

      {link !== null && (
        <div className="flex flex-col gap-1.5" data-testid="project-invite-url-block">
          <div className="flex flex-wrap items-center gap-2">
            <Input readOnly value={link.inviteUrl} className="min-w-0 flex-1" aria-label="邀请链接"
              onFocus={(e) => e.currentTarget.select()} data-testid="project-invite-url-value" />
            <Button size="sm" variant="primary" onClick={() => void copy()} data-testid="project-invite-url-copy">
              {copyState === "copied" ? "已复制" : copyState === "failed" ? "请手动复制" : "复制"}
            </Button>
          </div>
          {link.replacedInvitationId !== null && (
            <p className="text-10 text-muted-foreground" data-testid="project-invite-url-replaced">旧链接已作废，请把新链接发给对方。</p>
          )}
        </div>
      )}

      {link === null && existing !== null && (
        <p className="text-11 text-muted-foreground" data-testid="project-invite-url-existing">
          已有一条有效链接。出于安全，原链接不会再次显示；需要新链接请重置。
        </p>
      )}

      {hasLink && expiresAt !== null && (
        <p className="text-11 text-muted-foreground" data-testid="project-invite-url-expiry">有效期至 {formatInviteDeadline(expiresAt)}</p>
      )}

      {hasLink && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirming ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)} data-testid="project-invite-url-reset">
              重置链接
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2" data-testid="project-invite-url-reset-confirm">
              <span className="text-11 text-destructive">重置后旧链接立刻失效，确定吗？</span>
              <Button size="xs" variant="destructive" disabled={busy} onClick={() => void issue()} data-testid="project-invite-url-reset-yes">
                {busy ? "重置中…" : "确定重置"}
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirming(false)} data-testid="project-invite-url-reset-no">
                取消
              </Button>
            </div>
          )}
        </div>
      )}

      {error !== null && <p role="alert" className="text-11 text-destructive" data-testid="project-invite-url-error">{error}</p>}
    </div>
  );
}
