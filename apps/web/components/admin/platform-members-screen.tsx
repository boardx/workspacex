"use client";
import * as React from "react";
import { Globe, RefreshCw, ShieldCheck, UserCog } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { PopoverSelect } from "@/components/org-admin/org-admin-screen";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import type { OrgRole } from "@/lib/identity";
import { useI18n } from "@/lib/i18n/provider";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  grantPlatformAdmin, listPlatformMembers, revokePlatformAdmin, setPlatformMemberOrgRole,
  type PlatformMemberRow, type PlatformMembershipRow,
} from "@/lib/live-platform-members";
import type { UiState } from "@/lib/ui-state";

/** Platform operators read/change organization roles; only superusers grant/revoke platform admins. */
type Failure =
  | { kind: "LAST_ADMIN" | "MEMBER_NOT_FOUND" | "NOT_PLATFORM_SUPERUSER" }
  | { kind: "http"; status: number }
  | { kind: "network" };
function failureCause(error: unknown): Failure {
  if (!(error instanceof ApiError)) return { kind: "network" };
  if (error.reasonCode === "LAST_ADMIN" || error.reasonCode === "MEMBER_NOT_FOUND" || error.reasonCode === "NOT_PLATFORM_SUPERUSER") return { kind: error.reasonCode };
  return { kind: "http", status: error.status };
}
type I18n = ReturnType<typeof useI18n>;
function failureText(failure: Failure, operation: "role" | "admin" | "list", { t, locale }: I18n): string {
  switch (failure.kind) {
    case "LAST_ADMIN": return t("platformMembers.lastAdmin");
    case "MEMBER_NOT_FOUND": return t(operation === "admin" ? "platformMembers.accountMissing" : "platformMembers.membershipMissing");
    case "NOT_PLATFORM_SUPERUSER": return t(operation === "role" ? "platformMembers.roleDenied" : "platformMembers.adminDenied");
    case "http": return httpFailureText(failure.status, locale);
    case "network": return httpFailureText(0, locale);
  }
}
type Load =
  | { kind: "loading" }
  | { kind: "ready"; members: PlatformMemberRow[] }
  | { kind: "forbidden" }
  | { kind: "failed"; failure: Failure };
type Notice =
  | { kind: "role"; name: string; org: string; previous: OrgRole; next: OrgRole }
  | { kind: "admin"; name: string; next: boolean };

export function PlatformMembersScreen({ state }: { state: UiState }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [banner, setBanner] = React.useState<Notice | null>(null);
  const session = useOptionalSession();
  const viewerUserId = session?.session?.userId ?? null;
  // 只有真正的平台超管能授予/撤销平台管理员——名册里查一下自己那一行的 `platformSuperuser`，
  // 而不是假设"能看到这块屏"就等于"能改这个角色"（平台管理员两者都是前者、都不是后者）。
  const viewerIsSuperuser =
    load.kind === "ready" && load.members.some((m) => m.userId === viewerUserId && m.platformSuperuser);

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const out = await listPlatformMembers();
      setLoad({ kind: "ready", members: out.members });
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "NOT_PLATFORM_SUPERUSER") {
        setLoad({ kind: "forbidden" });
        return;
      }
      setLoad({
        kind: "failed",
        failure: failureCause(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(timer);
  }, [banner]);

  // 改角色成功后就地更新那一条成员身份，不整表重拉（名册按人 × 组织展开，重拉会整屏闪）。
  const handleChanged = (userId: string, orgId: string, next: OrgRole, previous: OrgRole) => {
    setLoad((prev) => {
      if (prev.kind !== "ready") return prev;
      const members = prev.members.map((m) =>
        m.userId === userId
          ? { ...m, memberships: m.memberships.map((ms) => (ms.orgId === orgId ? { ...ms, orgRole: next } : ms)) }
          : m,
      );
      const who = prev.members.find((m) => m.userId === userId);
      const org = who?.memberships.find((ms) => ms.orgId === orgId);
      setBanner({ kind: "role", name: who?.displayName ?? userId, org: org?.orgName ?? orgId, previous, next });
      return { kind: "ready", members };
    });
  };

  // 授予/撤销平台管理员成功后就地更新那一行，不整表重拉——理由同 `handleChanged`。
  const handleAdminChanged = (userId: string, next: boolean) => {
    setLoad((prev) => {
      if (prev.kind !== "ready") return prev;
      const members = prev.members.map((m) => (m.userId === userId ? { ...m, platformAdmin: next } : m));
      const who = prev.members.find((m) => m.userId === userId);
      setBanner({ kind: "admin", name: who?.displayName ?? userId, next });
      return { kind: "ready", members };
    });
  };

  const total = load.kind === "ready" ? load.members.length : null;

  return (
    <AdminScreen
      state={state}
      moduleLabel={t("adminNavigation.item.platform")}
      title={t("adminNavigation.item.platform")}
      liveBacked
      hideOrgIdentity
      intro={t("platformMembers.intro")}
      emptyHint={t("platformMembers.empty")}
      depFailure={t("platformMembers.dependency")}
      denialReason={t("platformMembers.denial")}
      successMessage={t("platformMembers.auditSuccess")}
    >
      <div className="flex flex-col gap-3" data-testid="admin-platform-members">
        <div className="flex flex-wrap items-center gap-2">
          <Globe aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="text-11 text-muted-foreground" data-testid="admin-platform-members-count">
            {total === null ? t("platformMembers.accounts") : t("platformMembers.count", { count: total })}{t("platformMembers.excluded")}
          </span>
          {load.kind === "ready" && (
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => void reload()} data-testid="admin-platform-members-reload">
              <RefreshCw aria-hidden className="h-3 w-3" /> {t("adminCommon.refresh")}
            </Button>
          )}
        </div>

        {banner ? (
          <div role="status" data-testid="admin-platform-members-banner" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-11 text-success">
            {banner.kind === "role"
              ? t("platformMembers.roleChange", { name: banner.name, org: banner.org, previous: t(`role.${banner.previous}`), next: t(`role.${banner.next}`) })
              : t(banner.next ? "platformMembers.granted" : "platformMembers.revoked", { name: banner.name })}
          </div>
        ) : null}

        {load.kind === "loading" && (
          <div role="status" aria-label={t("platformMembers.loading")} data-testid="admin-platform-members-loading" className="flex animate-pulse flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {load.kind === "forbidden" && (
          <p className="rounded-md border border-border bg-panel p-3 text-12 text-muted-foreground" data-testid="admin-platform-members-forbidden">
            {t("platformMembers.denial")}
          </p>
        )}

        {load.kind === "failed" && (
          <div className="flex flex-col items-start gap-2" data-testid="admin-platform-members-failed">
            <p className="text-12 text-muted-foreground">
              {t("platformMembers.loadFailed")} {failureText(load.failure, "list", i18n)}
            </p>
            <Button size="sm" variant="outline" onClick={() => void reload()}>{t("adminCommon.retry")}</Button>
          </div>
        )}

        {load.kind === "ready" && load.members.length === 0 && (
          <p className="text-12 text-muted-foreground" data-testid="admin-platform-members-empty">{t("platformMembers.empty")}</p>
        )}

        {load.kind === "ready" && load.members.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="admin-platform-members-list">
            {load.members.map((m) => (
              <PlatformMemberItem
                key={m.userId}
                member={m}
                onChanged={handleChanged}
                viewerIsSuperuser={viewerIsSuperuser}
                onAdminChanged={handleAdminChanged}
              />
            ))}
          </ul>
        )}
      </div>
    </AdminScreen>
  );
}

function PlatformMemberItem({
  member, onChanged, viewerIsSuperuser, onAdminChanged,
}: {
  member: PlatformMemberRow;
  onChanged: (userId: string, orgId: string, next: OrgRole, previous: OrgRole) => void;
  viewerIsSuperuser: boolean;
  onAdminChanged: (userId: string, next: boolean) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <li className="flex flex-col gap-2 px-3 py-2" data-testid={`admin-platform-member-${member.userId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-full min-w-0 items-start gap-2 sm:w-auto sm:min-w-48 sm:flex-1 sm:items-center">
          <Avatar initials={member.displayName.slice(0, 1)} size="sm" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="break-words text-13 font-medium" data-testid={`admin-platform-member-${member.userId}-name`}>{member.displayName}</span>
            <span className="break-all text-10 text-muted-foreground">{member.email}</span>
          </div>
        </div>
        {member.platformSuperuser && (
          <Badge tone="danger" data-testid={`admin-platform-member-${member.userId}-superuser`}>
            <ShieldCheck aria-hidden className="mr-1 h-3 w-3" />
            {t("platformMembers.superuser")}
          </Badge>
        )}
        {/* 平台超管不需要再叠一个"平台管理员"徽章——权限已经在超管之上，见 domain 头注。 */}
        {!member.platformSuperuser && (
          <PlatformAdminBadge member={member} viewerIsSuperuser={viewerIsSuperuser} onAdminChanged={onAdminChanged} />
        )}
        {!member.emailVerified && <Badge tone="warning">{t("platformMembers.unverified")}</Badge>}
        <span className="text-10 text-muted-foreground">{t("platformMembers.registered", { date: new Date(member.createdAt).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN") })}</span>
      </div>
      {member.memberships.length === 0 ? (
        <p className="pl-8 text-10 text-muted-foreground" data-testid={`admin-platform-member-${member.userId}-no-org`}>
          {t("platformMembers.noOrg")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 pl-8">
          {member.memberships.map((ms) => (
            <MembershipRow key={ms.orgId} userId={member.userId} membership={ms} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * "平台管理员"徽章（platform-admin-role delta）——落库、权限比平台超管窄的第二个身份
 * （见 `domain/system/platform-admin.ts` 头注）。非平台管理员时渲染一个"设为平台管理员"
 * 按钮；已经是时渲染徽章 + 一个"撤销"按钮。两个按钮都**只在当前登录者本人是平台超管时
 * 才出现**——一个平台管理员看得到别人的这个徽章，但看不到能点的按钮，因为后端本来就会
 * 拒绝他调用这两条接口（`grantPlatformAdmin`/`revokePlatformAdmin` 只认平台超管白名单）：
 * 前端不渲染一个注定 403 的按钮。
 */
function PlatformAdminBadge({
  member, viewerIsSuperuser, onAdminChanged,
}: {
  member: PlatformMemberRow;
  viewerIsSuperuser: boolean;
  onAdminChanged: (userId: string, next: boolean) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<Failure | null>(null);
  const testid = `admin-platform-member-${member.userId}-admin`;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = member.platformAdmin
        ? await revokePlatformAdmin(member.userId)
        : await grantPlatformAdmin(member.userId);
      onAdminChanged(member.userId, out.platformAdmin);
    } catch (err) {
      setError(failureCause(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex max-w-full flex-wrap items-center gap-1">
      {member.platformAdmin && (
        <Badge tone="primary" data-testid={`${testid}-badge`}>
          <UserCog aria-hidden className="mr-1 h-3 w-3" />
          {t("platformMembers.admin")}
        </Badge>
      )}
      {viewerIsSuperuser && (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void toggle()}
          data-testid={`${testid}-toggle`}
          className="h-auto whitespace-normal py-1 text-left"
        >
          {t(member.platformAdmin
            ? (busy ? "platformMembers.revoking" : "platformMembers.revoke")
            : (busy ? "platformMembers.granting" : "platformMembers.grant"))}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-10 text-destructive" data-testid={`${testid}-error`}>
          {failureText(error, "admin", i18n)}
        </span>
      )}
    </span>
  );
}

/**
 * 一条「人 × 组织」的成员身份：组织名 + 该组织里的角色下拉。
 * 控件复用 `PopoverSelect`（同组织级 `OrgRolePicker`，F06 的理由）。
 */
function MembershipRow({
  userId, membership, onChanged,
}: {
  userId: string;
  membership: PlatformMembershipRow;
  onChanged: (userId: string, orgId: string, next: OrgRole, previous: OrgRole) => void;
}) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<Failure | null>(null);
  const testid = `admin-platform-member-${userId}-org-${membership.orgId}`;

  const handleSelect = async (id: string) => {
    const next = id as OrgRole;
    if (next === membership.orgRole) return;
    setBusy(true);
    setError(null);
    try {
      const out = await setPlatformMemberOrgRole(userId, membership.orgId, next);
      onChanged(userId, membership.orgId, out.orgRole, out.previousOrgRole);
    } catch (err) {
      setError(failureCause(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2" data-testid={testid}>
      <span className="max-w-full break-words text-12" data-testid={`${testid}-name`}>{membership.orgName}</span>
      <span className="text-10 text-muted-foreground">{t("platformMembers.joined", { date: new Date(membership.joinedAt).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN") })}</span>
      <div className="ml-auto w-40 max-w-full">
        <PopoverSelect
          value={membership.orgRole}
          options={(["consultant", "lead", "compliance", "admin"] as const).map((id) => ({ id, label: t(`role.${id}`) }))}
          onSelect={(id) => void handleSelect(id)}
          disabled={busy}
          testid={`${testid}-role`}
          ariaLabel={t("platformMembers.roleLabel", { name: membership.orgName })}
        />
      </div>
      {error && (
        <span role="alert" className="basis-full text-10 text-destructive" data-testid={`${testid}-role-error`}>
          {failureText(error, "role", i18n)}
        </span>
      )}
    </li>
  );
}
