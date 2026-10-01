"use client";
import * as React from "react";
import { UserPlus, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminModal, Toast } from "./panel";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
import { buildActivationLink } from "@/lib/activation-link";
import {
  listOrgMembers, listOrgInvites, resendOrgInvite,
  type ListOrgMembersOut, type ListOrgInvitesOut,
} from "@/lib/live-org-admin";
import {
  InviteMemberForm, INVITE_STATUS_LABEL, OneTimeActivationLink, type OneTimeLink,
} from "@/components/org-admin/org-admin-screen";

/**
 * F11 —— 「成员与配额」屏上「名册 + 待处理邀请」区块的真栈实现，替掉此前的
 * `lib/mock/org-admin.ORG_MEMBERS`（此前贴着 `DemoBadge` 的那一块，见 issue #863
 * coord-main 2026-08-12 裁决第 4 条：当时定的是「先不做」，不是「不用做」）。
 *
 * 数据源与 `/org-admin/invites`、`/org-admin/members` 同一组真实端点
 * （`listOrgMembers` / `listOrgInvites` / `resendOrgInvite`）。
 *
 * ⚠ 这不是把「组织成员」那一屏的邀请管理重做一遍：邀请的创建复用已导出、已有
 * 测试覆盖的 `InviteMemberForm`；批准/拒绝（双人复核）与撤销仍只在 `/org-admin/invites`
 * 一处——这里只做「谁在候场」的摘要 + 重发，避免同一套邀请状态机在两处各写一份
 * （AGENTS.md：同一事实不得声明在两处）。
 */
export function MemberInvitesPanel() {
  const session = useOptionalSession()?.session ?? null;
  const orgId = session?.currentOrgId ?? null;
  if (!orgId) return <p className="p-3 text-12 text-muted-foreground">尚未选择组织。</p>;
  return <OrgMemberInvitesPanel key={orgId} orgId={orgId} />;
}

function OrgMemberInvitesPanel({ orgId }: { orgId: string }) {
  const mounted = React.useRef(false);
  const loadEpoch = React.useRef(0);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadEpoch.current += 1; };
  }, []);

  const [members, setMembers] = React.useState<ListOrgMembersOut | null>(null);
  const [invites, setInvites] = React.useState<ListOrgInvitesOut | null>(null);
  const [invitesDenied, setInvitesDenied] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [oneTimeLink, setOneTimeLink] = React.useState<OneTimeLink | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!mounted.current) return;
    const epoch = ++loadEpoch.current;
    const current = () => mounted.current && loadEpoch.current === epoch;
    setLoadError(null);
    try {
      const out = await listOrgMembers(orgId);
      if (!current()) return;
      setMembers(out);
    } catch (err) {
      if (!current()) return;
      // 失败就说失败，不退回 mock 名单——一屏看起来正常但人是假的，比一条错误消息危险得多。
      setLoadError(err instanceof ApiError && err.status === 404 ? "这个组织找不到了，请重新选择组织。" : describeFailure(err));
      return;
    }
    try {
      const out = await listOrgInvites(orgId);
      if (!current()) return;
      setInvites(out);
      setInvitesDenied(false);
    } catch (err) {
      if (!current()) return;
      if (err instanceof ApiError && err.status === 403) {
        setInvitesDenied(true);
        setInvites(null);
        return;
      }
      setLoadError(err instanceof ApiError && err.status === 404 ? "这个组织找不到了，请重新选择组织。" : describeFailure(err));
    }
  }, [orgId]);

  React.useEffect(() => { void load(); }, [load]);

  async function resend(inviteId: string, email: string) {
    if (!mounted.current) return;
    setBusyId(inviteId);
    try {
      const out = await resendOrgInvite(orgId, inviteId);
      if (!mounted.current) return;
      setOneTimeLink({ email, url: buildActivationLink(out.activationToken, window.location.origin), kind: "resent" });
      setToast(`已对 ${email} 重发；旧链接立即失效（冷却 ${out.cooldownSec} 秒）`);
      await load();
    } catch (err) {
      if (!mounted.current) return;
      setToast(err instanceof ApiError && err.status === 404 ? "这条邀请找不到了，请刷新成员列表。" : `重发失败：${describeFailure(err)}`);
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  if (!orgId) return <p className="p-3 text-12 text-muted-foreground">尚未选择组织。</p>;
  if (loadError) {
    return (
      <Card data-testid="admin-members-load-failed">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 text-12">
          <span className="text-destructive">成员数据读取失败：{loadError}</span>
          <Button size="xs" variant="outline" onClick={() => void load()}>重试</Button>
        </CardContent>
      </Card>
    );
  }
  if (!members) return <p className="p-3 text-12 text-muted-foreground">正在读取成员…</p>;

  const pendingInvites = (invites?.invites ?? []).filter((i) => i.status !== "used" && i.status !== "revoked");
  const activeCount = members.members.filter((m) => m.status === "active").length;

  return (
    <section className="flex flex-col gap-2" data-testid="admin-members-list">
      <div className="flex flex-wrap items-center gap-2" data-testid="admin-members-invite-bar">
        <span className="text-11 text-muted-foreground" data-testid="admin-members-roster-count">
          成员 {members.members.length} 人 · 活跃 {activeCount} 人
          {invitesDenied ? "" : ` · 待处理邀请 ${pendingInvites.length} 条`}
        </span>
        <Button
          size="xs"
          variant="primary"
          className="ml-auto"
          onClick={() => setInviteOpen(true)}
          data-testid="admin-members-invite-open"
        >
          <UserPlus aria-hidden className="h-3.5 w-3.5" />
          邀请成员
        </Button>
      </div>

      {invitesDenied && (
        <p className="text-11 text-muted-foreground" data-testid="admin-members-invites-denied">
          待处理邀请仅组织管理员可见。
        </p>
      )}

      {!invitesDenied && pendingInvites.length > 0 && (
        <Card>
          <CardContent className="flex flex-col divide-y divide-border pt-2">
            {pendingInvites.map((inv) => {
              const canResend = inv.status === "pending" || inv.status === "send-failed";
              return (
                <div
                  key={inv.inviteId}
                  data-testid={`admin-member-pending-${inv.inviteId}`}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-13 font-medium">{inv.email}</span>
                  <Badge
                    tone={inv.status === "pending" ? "warning" : inv.status === "awaiting-review" ? "outline" : "danger"}
                    data-testid={`admin-member-status-${inv.status}`}
                  >
                    {INVITE_STATUS_LABEL[inv.status] ?? inv.status}
                  </Badge>
                  <span className="text-11 text-muted-foreground">由 {inv.invitedBy} 邀请</span>
                  {canResend && (
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-auto"
                      disabled={busyId === inv.inviteId}
                      onClick={() => void resend(inv.inviteId, inv.email)}
                      data-testid={`admin-member-resend-${inv.inviteId}`}
                    >
                      <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                      {busyId === inv.inviteId ? "重发中…" : "重发"}
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {oneTimeLink && <OneTimeActivationLink link={oneTimeLink} onDismiss={() => setOneTimeLink(null)} />}

      <p className="text-10 text-muted-foreground">
        激活链接一次性、有有效期；链接携带的组织 / 角色
        <strong className="text-background-foreground">以服务端为准，篡改无效</strong>。
      </p>

      {inviteOpen && (
        <AdminModal
          testid="admin-members-invite-dialog"
          title="邀请成员"
          subtitle="发一条一次性激活链接；入场即带好组织角色。"
          onClose={() => setInviteOpen(false)}
        >
          <InviteMemberForm
            orgId={orgId}
            onSucceeded={(text) => { setToast(text); setInviteOpen(false); void load(); }}
            onFailed={(text) => setToast(text)}
            onLink={(link) => setOneTimeLink(link)}
          />
        </AdminModal>
      )}

      <Toast message={toast} testid="admin-members-toast" onDismiss={() => setToast(null)} />
    </section>
  );
}
