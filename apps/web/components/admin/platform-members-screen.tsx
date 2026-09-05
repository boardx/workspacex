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
import { ORG_ROLE_LABEL, type OrgRole } from "@/lib/identity";
import {
  grantPlatformAdmin, listPlatformMembers, revokePlatformAdmin, setPlatformMemberOrgRole,
  type PlatformMemberRow, type PlatformMembershipRow,
} from "@/lib/live-platform-members";
import type { UiState } from "@/lib/ui-state";

/**
 * `/platform-admin/members`（原 `/admin/platform`，2026-09-02 迁入平台后台）—— 成员管理的**平台级**（member-role-management delta）。
 *
 * 与 `/org-admin` 的「成员」标签页（组织级）是同一件事的两个视角：那边是组织 admin 看
 * **本组织**的人、改本组织里的角色；这边是平台超管看**全平台**的账号、改任一组织里的角色。
 * 两边改角色落的是同一列、走的是同一条「最后一名 admin」判定，只有授权面不同。
 *
 * ⚠ 两条接口都只对平台超管放行。403 `NOT_PLATFORM_SUPERUSER` **不是**失败态——它是
 *   「你不是这个身份」的正常结果，渲染成一句说明而不是重试按钮（同旧 `feedback-screen.tsx`
 *   系统异常区的处置——该文件已随 B3.6 旧屏退役删除，处置模式沿用到这里）。
 *
 * lint-no-backend-badge:backed-by-children —— 本屏的真实请求都在本文件内
 * （`listPlatformMembers` / `setPlatformMemberOrgRole`，`lib/live-platform-members.ts`）。
 */

type Load =
  | { kind: "loading" }
  | { kind: "ready"; members: PlatformMemberRow[] }
  | { kind: "forbidden" }
  | { kind: "failed"; reason: string };

const ORG_ROLE_OPTIONS: ReadonlyArray<{ id: OrgRole; label: string }> = (
  ["consultant", "lead", "compliance", "admin"] as const
).map((r) => ({ id: r, label: ORG_ROLE_LABEL[r] }));

function describeRoleChangeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    switch (failure.reasonCode) {
      case "LAST_ADMIN":
        return "这是该组织最后一名管理员，不能降级：先把该组织的另一位成员设为管理员。";
      case "MEMBER_NOT_FOUND":
        return "这条成员身份已不存在（可能刚被移除），请刷新名册。";
      case "NOT_PLATFORM_SUPERUSER":
        return "只有平台超管能调整角色。";
      default:
        return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
    }
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}

/** 授予/撤销平台管理员失败的说明——只有 `grantPlatformAdmin`/`revokePlatformAdmin` 会走到这里。 */
function describePlatformAdminChangeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    switch (failure.reasonCode) {
      case "MEMBER_NOT_FOUND":
        return "这个账号已不存在（可能刚被注销），请刷新名册。";
      case "NOT_PLATFORM_SUPERUSER":
        return "只有平台超管能授予/撤销平台管理员——平台管理员自己不能。";
      default:
        return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
    }
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}

export function PlatformMembersScreen({ state }: { state: UiState }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [banner, setBanner] = React.useState<string | null>(null);
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
        reason: err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
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
      setBanner(`已更新组织角色：${who?.displayName ?? userId} · ${org?.orgName ?? orgId}：${ORG_ROLE_LABEL[previous]} → ${ORG_ROLE_LABEL[next]}`);
      return { kind: "ready", members };
    });
  };

  // 授予/撤销平台管理员成功后就地更新那一行，不整表重拉——理由同 `handleChanged`。
  const handleAdminChanged = (userId: string, next: boolean) => {
    setLoad((prev) => {
      if (prev.kind !== "ready") return prev;
      const members = prev.members.map((m) => (m.userId === userId ? { ...m, platformAdmin: next } : m));
      const who = prev.members.find((m) => m.userId === userId);
      setBanner(`${who?.displayName ?? userId}：${next ? "已设为平台管理员" : "已撤销平台管理员身份"}`);
      return { kind: "ready", members };
    });
  };

  const total = load.kind === "ready" ? load.members.length : null;

  return (
    <AdminScreen
      state={state}
      moduleLabel="平台成员"
      title="平台成员"
      liveBacked
      hideOrgIdentity
      intro="平台上全部账号及其在各组织里的成员身份。这是成员管理的平台级：只对平台超管或被指定的平台管理员开放；每个组织自己的成员管理在「组织管理 → 成员」。"
      emptyHint="平台上还没有任何账号"
      depFailure="名册读取依赖身份服务；不可用时不显示任何账号，不用旧数据顶替。"
      denialReason="平台成员仅平台超管或平台管理员可见；组织管理员请到「组织管理」调整本组织成员。"
      successMessage="已更新组织角色；本次操作已记入该组织的审计"
    >
      <div className="flex flex-col gap-3" data-testid="admin-platform-members">
        <div className="flex flex-wrap items-center gap-2">
          <Globe aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="text-11 text-muted-foreground" data-testid="admin-platform-members-count">
            {total === null ? "全平台账号" : `全平台 ${total} 个账号`}（本地组织与平台维护身份不在名册内）
          </span>
          {load.kind === "ready" && (
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => void reload()} data-testid="admin-platform-members-reload">
              <RefreshCw aria-hidden className="h-3 w-3" /> 刷新
            </Button>
          )}
        </div>

        {banner ? (
          <div role="status" data-testid="admin-platform-members-banner" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-11 text-success">
            {banner}
          </div>
        ) : null}

        {load.kind === "loading" && (
          <div data-testid="admin-platform-members-loading" className="flex animate-pulse flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {load.kind === "forbidden" && (
          <p className="rounded-md border border-border bg-panel p-3 text-12 text-muted-foreground" data-testid="admin-platform-members-forbidden">
            这块屏仅平台运维（平台超管白名单 <code className="text-11">PLATFORM_SUPERUSER_EMAILS</code>，或被超管指定的平台管理员）可见——你当前的账号看不到全平台名册，这不是数据缺失。
            本组织的成员与角色请到「组织管理 → 成员」调整。
          </p>
        )}

        {load.kind === "failed" && (
          <div className="flex flex-col items-start gap-2" data-testid="admin-platform-members-failed">
            <p className="text-12 text-muted-foreground">
              没能读到平台名册（{load.reason}）。这不是「没有账号」——数据没有丢，只是这次没取到。
            </p>
            <Button size="sm" variant="outline" onClick={() => void reload()}>重试</Button>
          </div>
        )}

        {load.kind === "ready" && load.members.length === 0 && (
          <p className="text-12 text-muted-foreground" data-testid="admin-platform-members-empty">平台上还没有任何账号。</p>
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
  return (
    <li className="flex flex-col gap-2 px-3 py-2" data-testid={`admin-platform-member-${member.userId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar initials={member.displayName.slice(0, 1)} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-13 font-medium" data-testid={`admin-platform-member-${member.userId}-name`}>{member.displayName}</span>
          <span className="truncate text-10 text-muted-foreground">{member.email}</span>
        </div>
        {member.platformSuperuser && (
          <Badge tone="danger" data-testid={`admin-platform-member-${member.userId}-superuser`}>
            <ShieldCheck aria-hidden className="mr-1 h-3 w-3" />
            平台超管
          </Badge>
        )}
        {/* 平台超管不需要再叠一个"平台管理员"徽章——权限已经在超管之上，见 domain 头注。 */}
        {!member.platformSuperuser && (
          <PlatformAdminBadge member={member} viewerIsSuperuser={viewerIsSuperuser} onAdminChanged={onAdminChanged} />
        )}
        {!member.emailVerified && <Badge tone="warning">邮箱未验证</Badge>}
        <span className="text-10 text-muted-foreground">{new Date(member.createdAt).toLocaleDateString("zh-CN")} 注册</span>
      </div>
      {member.memberships.length === 0 ? (
        <p className="pl-8 text-10 text-muted-foreground" data-testid={`admin-platform-member-${member.userId}-no-org`}>
          尚未加入任何正式组织
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
      setError(describePlatformAdminChangeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-1">
      {member.platformAdmin && (
        <Badge tone="primary" data-testid={`${testid}-badge`}>
          <UserCog aria-hidden className="mr-1 h-3 w-3" />
          平台管理员
        </Badge>
      )}
      {viewerIsSuperuser && (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void toggle()}
          data-testid={`${testid}-toggle`}
        >
          {member.platformAdmin ? "撤销平台管理员" : "设为平台管理员"}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-10 text-destructive" data-testid={`${testid}-error`}>
          {error}
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
      setError(describeRoleChangeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2" data-testid={testid}>
      <span className="text-12" data-testid={`${testid}-name`}>{membership.orgName}</span>
      <span className="text-10 text-muted-foreground">{new Date(membership.joinedAt).toLocaleDateString("zh-CN")} 加入</span>
      <div className="ml-auto w-32">
        <PopoverSelect
          value={membership.orgRole}
          options={ORG_ROLE_OPTIONS}
          onSelect={(id) => void handleSelect(id)}
          disabled={busy}
          testid={`${testid}-role`}
          ariaLabel={`${membership.orgName} 的组织角色`}
        />
      </div>
      {error && (
        <span role="alert" className="basis-full text-10 text-destructive" data-testid={`${testid}-role-error`}>
          {error}
        </span>
      )}
    </li>
  );
}
