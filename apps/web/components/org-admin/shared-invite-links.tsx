"use client";

import * as React from "react";
import { AlertTriangle, Ban, Copy, Link2, Plus } from "lucide-react";
import { orgAdmin } from "@repo/contracts";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import { buildSharedInviteLink } from "@/lib/activation-link";
import {
  createOrgInviteLink, listOrgInviteLinks, revokeOrgInviteLink,
  type ListOrgInviteLinksOut,
} from "@/lib/live-org-admin";
import { useI18n } from "@/lib/i18n/provider";
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

type Feedback = (t: Translate) => string;
type Translate = ReturnType<typeof useI18n>["t"];
function roleLabelFor(role: string, t: Translate) {
  switch (role) {
    case "admin": return t("role.admin");
    case "lead": return t("role.lead");
    case "consultant": return t("invitation.memberRole");
    case "compliance": return t("role.compliance");
    default: return role;
  }
}
function expiryLabelFor(value: string, t: Translate) {
  switch (value) {
    case "1d": return t("orgSharedInvites.expiry1d");
    case "7d": return t("orgSharedInvites.expiry7d");
    case "30d": return t("orgSharedInvites.expiry30d");
    default: return value;
  }
}
function statusLabelFor(value: string, t: Translate) {
  switch (value) {
    case "pending-review": return t("invitation.needsResend");
    case "active": return t("orgSharedInvites.statusactive");
    case "expired": return t("orgSharedInvites.statusexpired");
    case "revoked": return t("orgSharedInvites.statusrevoked");
    case "exhausted": return t("orgSharedInvites.statusexhausted");
    default: return value;
  }
}

function statusTone(status: string): "primary" | "warning" | "neutral" | "outline" | "danger" {
  switch (status) {
    case "active": return "primary";
    case "pending-review": return "warning";
    case "exhausted": return "danger";
    default: return "outline";
  }
}

function describeLinkFailure(failure: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  if (failure instanceof ApiError) {
    switch (failure.reasonCode) {
      case "INVITE_SELF_REVIEW_FORBIDDEN":
        return t("orgSharedInvites.selfReview");
      case "VERSION_CHANGED":
        return t("orgSharedInvites.versionChanged");
      case "INVITE_NOT_FOUND":
        return t("orgSharedInvites.notFound");
      case "PROJECT_ROLE_INSUFFICIENT":
        return t("orgSharedInvites.adminOnly");
      case "NO_ORG_MEMBERSHIP":
        return t("orgSharedInvites.membership");
    }
    if (failure.status === 401) return t("orgSharedInvites.unauthorized");
    return t("orgSharedInvites.httpFailure", { reason: failure.reasonCode ?? t("orgSharedInvites.operationFailed"), status: failure.status });
  }
  return failure instanceof Error ? failure.message : t("orgSharedInvites.failed");
}

/** 一次性链接展示块（#953 四态纪律：展示 / 已复制 / 复制失败降级 / 关闭消失）。 */
function SharedLinkRevealBlock({ reveal, onDismiss }: { reveal: SharedLinkReveal; onDismiss: () => void }) {
  const { t } = useI18n();
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const roleLabel = roleLabelFor(reveal.orgRole, t);

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
      aria-label={t("orgSharedInvites.onceLabel")}
    >
      <p className="text-12 font-medium">
        {reveal.kind === "approved"
          ? t("orgSharedInvites.approvedReveal", { role: roleLabel })
          : t("orgSharedInvites.createdReveal", { role: roleLabel })}
      </p>
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          readOnly
          value={reveal.url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 flex-1 font-mono text-11"
          aria-label={t("orgSharedInvites.onceLabel")}
          data-testid="org-admin-shared-link-url"
        />
        <Button type="button" size="xs" variant="primary" onClick={() => void copy()} data-testid="org-admin-shared-link-copy">
          <Copy aria-hidden className="h-3 w-3" />
          {copyState === "copied" ? t("orgSharedInvites.copied") : t("orgSharedInvites.copy")}
        </Button>
      </div>
      {copyState === "copied" && (
        <p role="status" className="text-10 text-success" data-testid="org-admin-shared-link-copied">
          {t("orgSharedInvites.copiedNote")}
        </p>
      )}
      {copyState === "failed" && (
        <p role="alert" className="text-10 text-destructive" data-testid="org-admin-shared-link-copy-failed">
          {t("orgSharedInvites.copyFailed")}
        </p>
      )}
      <p className="text-10 text-warning" data-testid="org-admin-shared-link-once-note">
        {t("orgSharedInvites.onceNote")}
      </p>
      <div>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss} data-testid="org-admin-shared-link-dismiss">
          {t("orgSharedInvites.dismiss")}
        </Button>
      </div>
    </div>
  );
}

function CreateLinkForm({
  orgId, onCreated, onFailed,
}: {
  orgId: string;
  onCreated: (out: { status: string; linkToken: string | null; orgRole: string }, notice: Feedback) => void;
  onFailed: (msg: Feedback) => void;
}) {
  const { t } = useI18n();
  const orgRole = "consultant" as const;
  const [expiry, setExpiry] = React.useState<Expiry>("7d"); // 拍板②：默认 7 天
  const [maxUsesRaw, setMaxUsesRaw] = React.useState(""); // 空 = 无上限（拍板②默认）
  const [fieldError, setFieldError] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let maxUses: number | null = null;
    const trimmed = maxUsesRaw.trim();
    if (trimmed.length > 0) {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        setFieldError(true);
        return;
      }
      maxUses = n;
    }
    setFieldError(false);
    setSubmitting(true);
    try {
      const out = await createOrgInviteLink({ orgId, orgRole, expiry, maxUses });
      setMaxUsesRaw("");
      const notice: Feedback = (t) =>
        out.status === "pending-review"
          ? t("orgSharedInvites.pendingNotice")
          : t("orgSharedInvites.createdNotice", { expiry: expiryLabelFor(expiry, t), limit: maxUses === null ? t("orgSharedInvites.unlimitedNotice") : t("orgSharedInvites.limitNotice", { count: maxUses }) });
      onCreated({ status: out.status, linkToken: out.linkToken, orgRole }, notice);
    } catch (err) {
      onFailed((t) => describeLinkFailure(err, t));
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
        <div className="flex w-28 flex-col gap-1">
          <Label id="org-admin-shared-link-expiry-label">{t("orgSharedInvites.expiry")}</Label>
          <PopoverSelect
            value={expiry}
            options={["1d", "7d", "30d"].map((id) => ({ id, label: expiryLabelFor(id, t) }))}
            onSelect={(id) => setExpiry(id as Expiry)}
            disabled={submitting}
            testid="org-admin-shared-link-expiry"
            ariaLabel={t("orgSharedInvites.expiry")}
          />
        </div>
        <div className="flex w-36 flex-col gap-1">
          <Label htmlFor="org-admin-shared-link-max-uses">{t("orgSharedInvites.maxUses")}</Label>
          <Input
            id="org-admin-shared-link-max-uses"
            inputMode="numeric"
            value={maxUsesRaw}
            onChange={(e) => {
              setMaxUsesRaw(e.currentTarget.value);
              if (fieldError) setFieldError(false);
            }}
            placeholder={t("orgSharedInvites.unlimited")}
            disabled={submitting}
            aria-invalid={fieldError}
            data-testid="org-admin-shared-link-max-uses"
          />
        </div>
      </div>
      {fieldError ? (
        <p role="alert" data-testid="err-shared-link-max-uses" className="text-10 text-destructive">{t("orgSharedInvites.invalidMaxUses")}</p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-10 text-muted-foreground">
          {t("orgSharedInvites.joinNote")}
        </p>
        <Button type="submit" size="sm" variant="primary" disabled={submitting} data-testid="org-admin-shared-link-create">
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {submitting ? t("orgSharedInvites.creating") : t("orgSharedInvites.create")}
        </Button>
      </div>
    </form>
  );
}

function LinkRow({
  orgId, link, onChanged, onSucceeded, onFailed, onReveal,
}: {
  orgId: string;
  link: ListOrgInviteLinksOut["links"][number];
  currentUserId: string | null;
  onChanged: () => void;
  onSucceeded: (text: Feedback) => void;
  onFailed: (text: Feedback) => void;
  onReveal: (reveal: SharedLinkReveal) => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = React.useState(false);

  const canRevoke = link.status === "active" || link.status === "pending-review";
  const roleLabel = roleLabelFor(link.orgRole, t);
  const expiryLabel = expiryLabelFor(link.expiry, t);

  async function run(action: () => Promise<Feedback>) {
    setBusy(true);
    try {
      const text = await action();
      onSucceeded(text);
      onChanged();
    } catch (err) {
      onFailed((t) => err instanceof Error && err.message === "replacement-revoke-failed"
        ? t("invitation.linkReplacementPartial") : describeLinkFailure(err, t));
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
          {statusLabelFor(link.status, t)}
        </Badge>
        <span className="text-10 text-muted-foreground">
          {expiryLabel}
          {link.expiresAt !== null ? t("orgSharedInvites.expiresAt", { date: new Date(link.expiresAt).toLocaleDateString(locale) }) : t("invitation.needsResend")}
        </span>
        <span className="text-10 text-muted-foreground" data-testid={`org-admin-shared-link-${link.linkId}-used`}>
          {t("orgSharedInvites.joinedCount", { count: link.usedCount, limit: link.maxUses !== null ? ` / ${link.maxUses}` : "" })}
        </span>
        <span className="text-10 text-muted-foreground">{t("orgSharedInvites.createdBy", { name: link.createdBy })}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {link.status === "pending-review" && (
            <Button type="button" size="xs" variant="outline" disabled={busy}
              data-testid={`org-admin-shared-link-${link.linkId}-replace`}
              onClick={() => run(async () => {
                const out = await createOrgInviteLink({ orgId, orgRole: "consultant", expiry: link.expiry, maxUses: link.maxUses });
                if (out.linkToken) onReveal({ url: buildSharedInviteLink(out.linkToken, window.location.origin), orgRole: "consultant", kind: "created" });
                try {
                  await revokeOrgInviteLink(orgId, link.linkId);
                } catch {
                  onChanged();
                  throw new Error("replacement-revoke-failed");
                }
                return (t) => t("invitation.linkReplaced");
              })}>
              {t("invitation.replaceLink")}
            </Button>
          )}
          {canRevoke && !confirmingRevoke && (
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              className="text-destructive"
              onClick={() => setConfirmingRevoke(true)}
              data-testid={`org-admin-shared-link-${link.linkId}-revoke`}
            >
              <Ban aria-hidden className="h-3 w-3" />
              {t("orgSharedInvites.revoke")}
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
              {t("orgSharedInvites.revokePrompt", { role: roleLabel, count: link.usedCount })}
            </span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button" size="xs" variant="destructive" disabled={busy}
              onClick={() =>
                run(async () => {
                  await revokeOrgInviteLink(orgId, link.linkId);
                  return (t) => t("orgSharedInvites.revokedNotice", { role: roleLabelFor(link.orgRole, t) });
                })
              }
              data-testid={`org-admin-shared-link-${link.linkId}-revoke-confirm-yes`}
            >
              {busy ? t("orgSharedInvites.revoking") : t("orgSharedInvites.confirmRevoke")}
            </Button>
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() => setConfirmingRevoke(false)}
              data-testid={`org-admin-shared-link-${link.linkId}-revoke-confirm-no`}
            >
              {t("orgSharedInvites.cancel")}
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
  const { t } = useI18n();
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<unknown>(null);
  const [out, setOut] = React.useState<ListOrgInviteLinksOut | null>(null);
  const [banner, setBanner] = React.useState<{ tone: "success" | "error"; text: Feedback } | null>(null);

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
      setFailureMessage(err);
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
    <section className="flex flex-col gap-3 pt-2" data-testid="org-admin-shared-links" aria-label={t("orgSharedInvites.title")}>
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Link2 aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-13 font-semibold">{t("orgSharedInvites.title")}</h2>
      </div>
      <p className="text-11 text-muted-foreground">
        {t("orgSharedInvites.description")}
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
          {banner.text(t)}
        </div>
      ) : null}

      <StateShell
        state={state}
        emptyHint={t("orgSharedInvites.empty")}
        depFailure={{ what: failureMessage ? describeLinkFailure(failureMessage, t) : t("orgSharedInvites.unavailable"), retry: load }}
        denial={{ layer: "organization", reason: t("orgSharedInvites.denied") }}
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
