"use client";

import * as React from "react";
import { AlertTriangle, Ban, Check, Copy, Hourglass, Link2, Plus, X } from "lucide-react";
import { orgAdmin } from "@repo/contracts";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import { buildSharedInviteLink } from "@/lib/activation-link";
import { ORG_ROLE_LABEL, type OrgRole } from "@/lib/identity";
import {
  createOrgInviteLink, listOrgInviteLinks, revokeOrgInviteLink, reviewOrgInviteLink,
  type ListOrgInviteLinksOut,
} from "@/lib/live-org-admin";
import { PopoverSelect } from "./org-admin-screen";

/**
 * 「共享邀请链接」区块（shared-invite-links delta，人类 2026-08-13 三条拍板）——
 * 挂在 `/org-admin` 邀请标签页下方。
 *
 * Slack/Discord 式：一个链接谁点谁能加入。建链选角色/有效期（默认 7 天）/人数上限
 * （默认无上限）；admin 级链接进「待复核」，另一位管理员批准后才签发（拍板③，
 * 发起人视角无自批按钮——照单人邀请消灭死按钮的先例）。
 *
 * 一次性明文展示块与 #953 同一纪律：链接明文只在建链/批准那一次响应里存在，
 * 服务端只存 hash——关闭后**连服务端也给不出来**，只能作废重建。
 * reveal state 由父层（OrgAdminScreen）持有：切标签页不销毁（复核 D1 的同一坑）。
 */

type Expiry = z.infer<typeof orgAdmin.OrgInviteLinkExpiry>;

export type SharedLinkReveal = {
  readonly url: string;
  readonly orgRole: string;
  /** created = 建链即签发；approved = 双人复核批准后签发。 */
  readonly kind: "created" | "approved";
};

const EXPIRY_OPTIONS: ReadonlyArray<{ id: Expiry; label: string }> = [
  { id: "1d", label: "1 天" },
  { id: "7d", label: "7 天" },
  { id: "30d", label: "30 天" },
];

const STATUS_LABEL: Record<string, string> = {
  "pending-review": "待复核",
  active: "生效中",
  expired: "已过期",
  revoked: "已作废",
  exhausted: "已用满",
};

function statusTone(status: string): "primary" | "warning" | "neutral" | "outline" | "danger" {
  switch (status) {
    case "active": return "primary";
    case "pending-review": return "warning";
    case "exhausted": return "danger";
    default: return "outline";
  }
}

const ROLE_OPTIONS: ReadonlyArray<{ id: OrgRole; label: string }> = (
  ["consultant", "lead", "compliance", "admin"] as const
).map((r) => ({ id: r, label: ORG_ROLE_LABEL[r] }));

function describeLinkFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    switch (failure.reasonCode) {
      case "INVITE_SELF_REVIEW_FORBIDDEN":
        return "不能复核自己创建的链接（双人复核），需要另一位管理员来批准或拒绝。";
      case "VERSION_CHANGED":
        return "链接状态已发生变化（可能已被其他管理员处理或已作废），列表已刷新。";
      case "INVITE_NOT_FOUND":
        return "链接不存在或当前身份不可见。";
      case "PROJECT_ROLE_INSUFFICIENT":
        return "只有组织管理员能管理共享链接（HTTP 403）。";
      case "NO_ORG_MEMBERSHIP":
        return "你不是该组织的成员（HTTP 403）。";
    }
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}

/** 一次性链接展示块（#953 四态纪律：展示 / 已复制 / 复制失败降级 / 关闭消失）。 */
function SharedLinkRevealBlock({ reveal, onDismiss }: { reveal: SharedLinkReveal; onDismiss: () => void }) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const roleLabel = ORG_ROLE_LABEL[reveal.orgRole as OrgRole] ?? reveal.orgRole;

  async function copy() {
    try {
      await navigator.clipboard.writeText(reveal.url);
      setCopyState("copied");
      window.setTimeout(() => setCopyState((s) => (s === "copied" ? "idle" : s)), 2500);
    } catch {
      setCopyState("failed");
      inputRef.current?.select();
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
      data-testid="org-admin-shared-link-block"
      role="region"
      aria-label="共享邀请链接（只显示这一次）"
    >
      <p className="text-12 font-medium">
        {reveal.kind === "approved"
          ? `已批准——「${roleLabel}」共享链接已生效：`
          : `「${roleLabel}」共享链接已创建：`}
      </p>
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          readOnly
          value={reveal.url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 flex-1 font-mono text-11"
          aria-label="共享邀请链接（只显示这一次）"
          data-testid="org-admin-shared-link-url"
        />
        <Button type="button" size="xs" variant="primary" onClick={() => void copy()} data-testid="org-admin-shared-link-copy">
          <Copy aria-hidden className="h-3 w-3" />
          {copyState === "copied" ? "已复制" : "复制"}
        </Button>
      </div>
      {copyState === "copied" && (
        <p role="status" className="text-10 text-success" data-testid="org-admin-shared-link-copied">
          已复制到剪贴板，任何拿到此链接的人都可在有效期内加入组织。
        </p>
      )}
      {copyState === "failed" && (
        <p role="alert" className="text-10 text-destructive" data-testid="org-admin-shared-link-copy-failed">
          浏览器拒绝了自动复制——链接已全选，请按 Ctrl/Cmd+C 手动复制。
        </p>
      )}
      <p className="text-10 text-warning" data-testid="org-admin-shared-link-once-note">
        链接只显示这一次（服务端只存散列、事后无法再给出明文）。点「关闭」、刷新或离开本页后无法找回
        （切换上方标签页不会丢失）；需要换链接请先作废再新建。
      </p>
      <div>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss} data-testid="org-admin-shared-link-dismiss">
          我已保存，关闭
        </Button>
      </div>
    </div>
  );
}

function CreateLinkForm({
  orgId, onCreated, onFailed,
}: {
  orgId: string;
  onCreated: (out: { status: string; linkToken: string | null; orgRole: string }, notice: string) => void;
  onFailed: (msg: string) => void;
}) {
  const [orgRole, setOrgRole] = React.useState<OrgRole>("consultant");
  const [expiry, setExpiry] = React.useState<Expiry>("7d"); // 拍板②：默认 7 天
  const [maxUsesRaw, setMaxUsesRaw] = React.useState(""); // 空 = 无上限（拍板②默认）
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let maxUses: number | null = null;
    const trimmed = maxUsesRaw.trim();
    if (trimmed.length > 0) {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        setFieldError("人数上限须为正整数；留空表示不限人数。");
        return;
      }
      maxUses = n;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const out = await createOrgInviteLink({ orgId, orgRole, expiry, maxUses });
      setMaxUsesRaw("");
      const expiryLabel = EXPIRY_OPTIONS.find((o) => o.id === expiry)?.label ?? expiry;
      const notice =
        out.status === "pending-review"
          ? `管理员级共享链接已创建，进入双人复核（待复核）：另一位管理员批准后才会签发链接（发起人不能自批）。`
          : `共享链接已创建（${expiryLabel}有效${maxUses === null ? "、不限人数" : `、最多 ${maxUses} 人`}）——见下方，只显示这一次。`;
      onCreated({ status: out.status, linkToken: out.linkToken, orgRole }, notice);
    } catch (err) {
      onFailed(describeLinkFailure(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3"
      onSubmit={handleSubmit}
      noValidate
      data-testid="org-admin-shared-link-form"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex w-32 flex-col gap-1">
          <Label id="org-admin-shared-link-role-label">加入后的角色</Label>
          <PopoverSelect
            value={orgRole}
            options={ROLE_OPTIONS}
            onSelect={(id) => setOrgRole(id as OrgRole)}
            disabled={submitting}
            testid="org-admin-shared-link-role"
            ariaLabel="加入后的角色"
          />
        </div>
        <div className="flex w-28 flex-col gap-1">
          <Label id="org-admin-shared-link-expiry-label">有效期</Label>
          <PopoverSelect
            value={expiry}
            options={EXPIRY_OPTIONS}
            onSelect={(id) => setExpiry(id as Expiry)}
            disabled={submitting}
            testid="org-admin-shared-link-expiry"
            ariaLabel="有效期"
          />
        </div>
        <div className="flex w-36 flex-col gap-1">
          <Label htmlFor="org-admin-shared-link-max-uses">人数上限（可选）</Label>
          <Input
            id="org-admin-shared-link-max-uses"
            inputMode="numeric"
            value={maxUsesRaw}
            onChange={(e) => {
              setMaxUsesRaw(e.currentTarget.value);
              if (fieldError) setFieldError(null);
            }}
            placeholder="不限"
            disabled={submitting}
            aria-invalid={fieldError !== null}
            data-testid="org-admin-shared-link-max-uses"
          />
        </div>
      </div>
      {fieldError ? (
        <p role="alert" data-testid="err-shared-link-max-uses" className="text-10 text-destructive">{fieldError}</p>
      ) : null}
      {orgRole === "admin" && (
        <p className="text-10 text-muted-foreground" data-testid="org-admin-shared-link-dual-review-note">
          管理员级共享链接需双人复核：创建后进入「待复核」（链接不可用），由另一位管理员批准后才签发（发起人不能自批）。
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-10 text-muted-foreground">
          任何拿到链接的人都可在有效期与人数上限内自助加入；实际加入仍受组织席位配额限制。
        </p>
        <Button type="submit" size="sm" variant="primary" disabled={submitting} data-testid="org-admin-shared-link-create">
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {submitting ? "创建中…" : "生成共享链接"}
        </Button>
      </div>
    </form>
  );
}

function LinkRow({
  orgId, link, currentUserId, onChanged, onSucceeded, onFailed, onReveal,
}: {
  orgId: string;
  link: ListOrgInviteLinksOut["links"][number];
  currentUserId: string | null;
  onChanged: () => void;
  onSucceeded: (text: string) => void;
  onFailed: (text: string) => void;
  onReveal: (reveal: SharedLinkReveal) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = React.useState(false);

  const isCreator = currentUserId !== null && link.createdByUserId === currentUserId;
  const canReview = link.status === "pending-review" && !isCreator;
  const waitingPeerReview = link.status === "pending-review" && isCreator;
  const canRevoke = link.status === "active" || link.status === "pending-review";
  const roleLabel = ORG_ROLE_LABEL[link.orgRole as OrgRole] ?? link.orgRole;
  const expiryLabel = EXPIRY_OPTIONS.find((o) => o.id === link.expiry)?.label ?? link.expiry;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      const text = await action();
      onSucceeded(text);
      onChanged();
    } catch (err) {
      onFailed(describeLinkFailure(err));
      if (err instanceof ApiError && err.reasonCode === "VERSION_CHANGED") onChanged();
    } finally {
      setBusy(false);
      setConfirmingRevoke(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2" data-testid={`org-admin-shared-link-${link.linkId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-13 font-medium">{roleLabel}</span>
        <Badge tone={statusTone(link.status)} data-testid={`org-admin-shared-link-${link.linkId}-status`}>
          {STATUS_LABEL[link.status] ?? link.status}
        </Badge>
        <span className="text-10 text-muted-foreground">
          {expiryLabel}
          {link.expiresAt !== null ? `（${new Date(link.expiresAt).toLocaleDateString("zh-CN")} 到期）` : "（批准后起算）"}
        </span>
        <span className="text-10 text-muted-foreground" data-testid={`org-admin-shared-link-${link.linkId}-used`}>
          已加入 {link.usedCount}{link.maxUses !== null ? ` / ${link.maxUses}` : ""} 人
        </span>
        <span className="text-10 text-muted-foreground">由 {link.createdBy} 创建</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {waitingPeerReview && (
            <span
              className="flex items-center gap-1 text-10 text-muted-foreground"
              data-testid={`org-admin-shared-link-${link.linkId}-waiting-peer-review`}
            >
              <Hourglass aria-hidden className="h-3 w-3" />
              你创建的链接：等待另一位管理员复核（不能自批）
            </span>
          )}
          {canReview && (
            <>
              <Button
                type="button" size="xs" variant="primary" disabled={busy}
                onClick={() =>
                  run(async () => {
                    const out = await reviewOrgInviteLink(orgId, link.linkId, "approve");
                    if (out.linkToken !== null) {
                      onReveal({
                        url: buildSharedInviteLink(out.linkToken, window.location.origin),
                        orgRole: link.orgRole,
                        kind: "approved",
                      });
                    }
                    return `已批准「${roleLabel}」共享链接，链接已生效——见下方，只显示这一次。`;
                  })
                }
                data-testid={`org-admin-shared-link-${link.linkId}-approve`}
              >
                <Check aria-hidden className="h-3 w-3" />
                批准
              </Button>
              <Button
                type="button" size="xs" variant="outline" disabled={busy}
                onClick={() =>
                  run(async () => {
                    await reviewOrgInviteLink(orgId, link.linkId, "reject");
                    return `已拒绝「${roleLabel}」共享链接，该链接不会生效。`;
                  })
                }
                data-testid={`org-admin-shared-link-${link.linkId}-reject`}
              >
                <X aria-hidden className="h-3 w-3" />
                拒绝
              </Button>
            </>
          )}
          {canRevoke && !confirmingRevoke && (
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              className="text-destructive"
              onClick={() => setConfirmingRevoke(true)}
              data-testid={`org-admin-shared-link-${link.linkId}-revoke`}
            >
              <Ban aria-hidden className="h-3 w-3" />
              作废
            </Button>
          )}
        </div>
      </div>

      {confirmingRevoke && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5"
          data-testid={`org-admin-shared-link-${link.linkId}-revoke-confirm`}
        >
          <div className="flex items-center gap-1.5 text-11 text-destructive">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span>
              确认作废这条「{roleLabel}」共享链接？作废后立即失效、无法恢复（已加入的 {link.usedCount} 人不受影响）。
            </span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button" size="xs" variant="destructive" disabled={busy}
              onClick={() =>
                run(async () => {
                  await revokeOrgInviteLink(orgId, link.linkId);
                  return `已作废「${roleLabel}」共享链接，该链接立即失效。`;
                })
              }
              data-testid={`org-admin-shared-link-${link.linkId}-revoke-confirm-yes`}
            >
              {busy ? "作废中…" : "确认作废"}
            </Button>
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() => setConfirmingRevoke(false)}
              data-testid={`org-admin-shared-link-${link.linkId}-revoke-confirm-no`}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function SharedInviteLinksSection({
  orgId, currentUserId, reveal, onReveal,
}: {
  orgId: string;
  currentUserId: string | null;
  /** 一次性明文展示 state 由 OrgAdminScreen 持有（切标签页存活，见文件头）。 */
  reveal: SharedLinkReveal | null;
  onReveal: (reveal: SharedLinkReveal | null) => void;
}) {
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<ListOrgInviteLinksOut | null>(null);
  const [banner, setBanner] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = React.useCallback(async () => {
    setState("loading");
    setFailureMessage(null);
    try {
      const result = await listOrgInviteLinks(orgId);
      setOut(result);
      setState(result.links.length === 0 ? "empty" : "default");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setState("denied");
        return;
      }
      setFailureMessage(describeLinkFailure(err));
      setState("dep-failed");
    }
  }, [orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(t);
  }, [banner]);

  return (
    <section className="flex flex-col gap-3 pt-2" data-testid="org-admin-shared-links" aria-label="共享邀请链接">
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Link2 aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-13 font-semibold">共享邀请链接</h2>
      </div>
      <p className="text-11 text-muted-foreground">
        一个链接谁点谁能加入（Slack/Discord 式）。可多次使用，直到过期、被作废或达到人数上限。
      </p>

      <CreateLinkForm
        orgId={orgId}
        onCreated={(created, notice) => {
          setBanner({ tone: "success", text: notice });
          if (created.linkToken !== null) {
            onReveal({
              url: buildSharedInviteLink(created.linkToken, window.location.origin),
              orgRole: created.orgRole,
              kind: "created",
            });
          }
          void load();
        }}
        onFailed={(text) => setBanner({ tone: "error", text })}
      />

      {reveal && <SharedLinkRevealBlock reveal={reveal} onDismiss={() => onReveal(null)} />}

      {banner ? (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          data-testid="org-admin-shared-link-banner"
          className={
            banner.tone === "success"
              ? "rounded-md border border-success/30 bg-success/10 px-3 py-2 text-11 text-success"
              : "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-11 text-destructive"
          }
        >
          {banner.text}
        </div>
      ) : null}

      <StateShell
        state={state}
        emptyHint="还没有创建过共享链接。"
        depFailure={{ what: failureMessage ?? "共享链接列表服务暂时不可用", retry: load }}
        denial={{ layer: "organization", reason: "共享链接仅组织管理员可管理；你在本组织不是管理员。" }}
      >
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="org-admin-shared-link-list">
          {out?.links.map((link) => (
            <LinkRow
              key={link.linkId}
              orgId={orgId}
              link={link}
              currentUserId={currentUserId}
              onReveal={onReveal}
              onChanged={() => void load()}
              onSucceeded={(text) => setBanner({ tone: "success", text })}
              onFailed={(text) => setBanner({ tone: "error", text })}
            />
          ))}
        </ul>
      </StateShell>
    </section>
  );
}
