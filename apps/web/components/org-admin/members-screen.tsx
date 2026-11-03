"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import {
  UserPlus, ShieldAlert, RefreshCw, Ban, UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminModal, ConfirmDialog, Field, Toast } from "@/components/admin/panel";
import type { UiState } from "@/lib/ui-state";
import type { OrgRole } from "@/lib/identity";
import { OrgAdminFrame } from "./org-admin-frame";
import {
  ORG_MEMBERS, ORG_MEMBER_TOTAL, ORG_MEMBER_ACTIVE,
  QUOTA_OVERVIEW, ADMIN_APPROVAL_QUEUE, ORG_ROLES_INVITABLE,
  AUTH_POLICY, type OrgMemberRow, type MemberStatus,
} from "@/lib/mock/org-admin";

/**
 * UC-1.6 · 组织成员邀请与激活（后台 → 成员与配额）
 *
 * ⚠ 与既有 `components/admin/members-screen.tsx`（配额/用量为主）**不同职责，不改它**：
 *   这里补 R8 标注为「原型待补 / 确认缺失」的邀请激活生命周期——
 *   [邀请成员] 弹层、双人复核（O-28 ⑥）、配额用尽硬阻断（O-29 ⑤）、撤销邀请、
 *   成员移除（O-29 ②）。
 * 只授予**组织层身份**（角色），不授予任何项目角色（那走 UC-1.3）。
 * 链接携带的组织 / 角色以服务端为准，篡改无效（AC5）。
 *
 * ⚠ 2026-09-03（issue #2615 裁决②「组织中去掉团队的概念」；#2620 已把真实 `/org-admin`
 *   路径的团队 CRUD 全部撤除后，人类进一步裁决：这份 ADR-023 签核原型也要跟着撤，
 *   不留一份"组织仍有团队"的第二套语义）：原来这里的"团队"增删改区块
 *   （`members-team-add`/`rename`/`delete`）、成员行的团队列、邀请弹层的团队选择器
 *   已整体移除。`ORG_MEMBERS`/`ADMIN_APPROVAL_QUEUE` 仍带 `team` 字段（`lib/mock/
 *   org-admin.ts`）——那份共享 mock 同时被真实的 `components/admin/members-screen.tsx`
 *   （`/admin/members`「成员配额」，F11 待收敛前仍读它）消费，删字段会连带打红那个真实
 *   屏，所以只在这个组件里不再渲染 `.team`，不改共享类型本身。
 */
export function MembersScreen({ state, orgRole }: { state: UiState; orgRole: OrgRole }) {
  const { t, locale } = useI18n();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [quotaExhausted, setQuotaExhausted] = React.useState(false);
  const [revoking, setRevoking] = React.useState<OrgMemberRow | null>(null);
  const [removing, setRemoving] = React.useState<OrgMemberRow | null>(null);
  const [toast, setToast] = React.useState<((t: ReturnType<typeof useI18n>["t"]) => string) | null>(null);

  // 只有管理员进后台「成员与配额」（R5）；其余组织角色不进后台。
  // ⚠ 2026-08-11 复核（PROTOTYPE-FIDELITY-AUDIT-2.md 问题 1）：这里曾经以「预览视角是否
  //   引导师」近似判定，把项目角色（引导师/组长/组员/观察者）当成了后台可达性的门禁——
  //   「成员与配额」是组织级屏，语义上跟项目角色无关，此前的写法与本屏自己的
  //   denial 文案（「仅组织管理员可进」）自相矛盾。改用真实的组织角色（服务端同判据）。
  const canAdmin = orgRole === "admin";

  return (
    <OrgAdminFrame
      state={state}
      uc="UC-1.6 R8"
      title={t("orgMembersPreview.title")}
      intro={t("orgMembersPreview.intro", { total: ORG_MEMBER_TOTAL, active: ORG_MEMBER_ACTIVE })}
      emptyHint={t("orgMembersPreview.empty")}
      errors={{ "invite-email": t("orgMembersPreview.emailError") }}
      depFailure={t("orgMembersPreview.dependency")}
      denial={{ layer: "organization", reason: t("orgMembersPreview.denial") }}
      successMessage={t("orgMembersPreview.success")}
      skeletonRows={6}
    >
      <div className="flex flex-col gap-5">
        {/* 顶部动作 + 配额总览 + 硬阻断演示开关 */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => setInviteOpen(true)} data-testid="members-invite-open" disabled={!canAdmin}>
              <UserPlus aria-hidden className="h-3.5 w-3.5" /> {t("orgMembersPreview.invite")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.exported"))} data-testid="members-export">{t("orgMembersPreview.export")}</Button>
            <label className="ml-auto flex items-center gap-1.5 text-10 text-muted-foreground">
              <input type="checkbox" checked={quotaExhausted} onChange={(e) => setQuotaExhausted(e.currentTarget.checked)} data-testid="members-quota-toggle" className="h-3.5 w-3.5 rounded-sm border border-input" />
              {t("orgMembersPreview.demo")}
            </label>
          </div>
          <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-panel p-3 text-11" data-testid="members-quota-overview">
            <span>{t("orgMembersPreview.allocated", { amount: QUOTA_OVERVIEW.allocatedM.toLocaleString(locale), percent: QUOTA_OVERVIEW.allocatedPct })}</span>
            <span className="text-muted-foreground">｜</span>
            <span>{t("orgMembersPreview.unallocated", { amount: quotaExhausted ? "0" : QUOTA_OVERVIEW.unallocatedM.toLocaleString(locale), hint: t(quotaExhausted ? "orgMembersPreview.usedUp" : "orgMembersPreview.reserve") })}</span>
            {quotaExhausted && <Badge tone="danger" data-testid="members-quota-exhausted">{t("orgMembersPreview.exhausted")}</Badge>}
          </div>
        </section>

        {/* 双人复核待批队列（O-28 ⑥） */}
        {ADMIN_APPROVAL_QUEUE.length > 0 && (
          <section className="flex flex-col gap-2" data-testid="members-approval-queue">
            <div className="flex items-center gap-1.5">
              <ShieldAlert aria-hidden className="h-4 w-4 text-warning" />
              <h2 className="text-14 font-semibold">{t("orgMembersPreview.approvalTitle")}</h2>
              <Badge tone="warning">{t("orgMembersPreview.noSelfApproval")}</Badge>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-warning/30 bg-warning/5">
              {ADMIN_APPROVAL_QUEUE.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="members-approval-row">
                  <span className="text-12 font-medium">{a.email}</span>
                  <Badge tone="danger">{t("role.admin")}</Badge>
                  <span className="text-11 text-muted-foreground">{t("orgMembersPreview.requested", { name: a.requestedBy, at: a.at })}</span>
                  <div className="ml-auto flex gap-1.5">
                    <Button size="xs" variant="primary" onClick={() => setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.approved"))} data-testid="members-approve">{t("orgMembersPreview.approve")}</Button>
                    <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.rejected"))} data-testid="members-approval-reject">{t("orgMembersPreview.reject")}</Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 成员表 */}
        <section className="flex flex-col gap-2" data-testid="members-table">
          <h2 className="text-14 font-semibold">{t("orgMembersPreview.tableTitle")}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {ORG_MEMBERS.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="members-row">
                <span className="w-16 shrink-0 text-13 font-medium">{m.name}</span>
                <Badge tone={m.role === "admin" ? "danger" : "neutral"}>
                  {t(`role.${m.role}`)}{m.status !== "active" ? t("orgMembersPreview.awaitActivation") : ""}
                </Badge>
                {m.external && (
                  <Badge tone="outline" data-testid="members-external-tag">{t("orgMembersPreview.external")}</Badge>
                )}
                <span className="w-20 text-11 text-muted-foreground">{m.usedM.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/{m.limitM.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M</span>
                <MemberStatusBadge status={m.status} sentDays={m.sentDays} />
                <div className="ml-auto flex gap-1.5">
                  {(m.status === "pending" || m.status === "send-failed" || m.status === "expired") && (
                    <>
                      <Button size="xs" variant="outline" disabled={!canAdmin} onClick={() => setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.resent", { name: m.name, seconds: AUTH_POLICY.resendCooldownSeconds, max: AUTH_POLICY.resendDailyMax }))} data-testid="members-resend">
                        <RefreshCw aria-hidden className="h-3 w-3" /> {t("orgMembersPreview.resend")}
                      </Button>
                      <Button size="xs" variant="ghost" disabled={!canAdmin} className="text-destructive" onClick={() => setRevoking(m)} data-testid="members-revoke">
                        <Ban aria-hidden className="h-3 w-3" /> {t("orgMembersPreview.revoke")}
                      </Button>
                    </>
                  )}
                  {m.status === "active" && m.role !== "admin" && (
                    <Button size="xs" variant="ghost" disabled={!canAdmin} className="text-destructive" onClick={() => setRemoving(m)} data-testid="members-remove">
                      <UserMinus aria-hidden className="h-3 w-3" /> {t("orgMembersPreview.remove")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-10 text-muted-foreground">{t("orgMembersPreview.countNote", { active: ORG_MEMBER_ACTIVE, total: ORG_MEMBER_TOTAL })}</p>
        </section>
      </div>

      {/* 邀请成员弹层 */}
      {inviteOpen && (
        <InviteMemberDialog
          quotaExhausted={quotaExhausted}
          onClose={() => setInviteOpen(false)}
          onToast={(m) => { setToast(() => m); setInviteOpen(false); }}
        />
      )}

      {/* 撤销未接受的邀请 */}
      {revoking && (
        <ConfirmDialog
          testid="members-revoke-dialog"
          title={t("orgMembersPreview.revokeTitle", { name: revoking.name })}
          tone="destructive"
          confirmLabel={t("orgMembersPreview.revokeConfirm")}
          impact={
            <div className="flex flex-col gap-1">
              <p>{t("orgMembersPreview.revokeImpact")}</p>
              <p>{t("orgMembersPreview.revokeInvalid")}</p>
            </div>
          }
          onCancel={() => setRevoking(null)}
          onConfirm={() => { const name = revoking.name; setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.revokedToast", { name })); setRevoking(null); }}
        />
      )}

      {/* 移除成员（O-29 ②：停用访问，保留署名与历史产出） */}
      {removing && (
        <ConfirmDialog
          testid="members-remove-dialog"
          title={t("orgMembersPreview.removeTitle", { name: removing.name })}
          tone="destructive"
          confirmLabel={t("orgMembersPreview.removeConfirm")}
          requireReason
          reasonPlaceholder={t("orgMembersPreview.removeReason")}
          impact={
            <div className="flex flex-col gap-1">
              <p>{t("orgMembersPreview.removalAccess")}</p>
              <p>{t("orgMembersPreview.removeSessions")}</p>
              <p>{t("orgMembersPreview.retainWork")}</p>
              <p>{t("orgMembersPreview.releaseQuota", { amount: removing.limitM.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</p>
              <p>{t("orgMembersPreview.removeAudit")}</p>
            </div>
          }
          onCancel={() => setRemoving(null)}
          onConfirm={() => { const name = removing.name; setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.removedToast", { name })); setRemoving(null); }}
        />
      )}

      <Toast message={toast?.(t) ?? null} testid="members-toast" onDismiss={() => setToast(null)} />
    </OrgAdminFrame>
  );
}

/* ── 邀请成员弹层：邮箱 + 角色三选 + 双人复核 + 配额硬阻断 ─────────── */

function InviteMemberDialog({
  quotaExhausted, onClose, onToast,
}: {
  quotaExhausted: boolean;
  onClose: () => void;
  onToast: (m: (t: ReturnType<typeof useI18n>["t"]) => string) => void;
}) {
  const { t } = useI18n();
  const [role, setRole] = React.useState<OrgRole>("consultant");
  const isAdmin = role === "admin";

  return (
    <AdminModal
      testid="members-invite-dialog"
      title={t("orgMembersPreview.invite")}
      subtitle={t("orgMembersPreview.inviteSubtitle")}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="members-invite-cancel">{t("orgMembersPreview.cancel")}</Button>
          <Button
            size="sm"
            variant={isAdmin ? "destructive" : "primary"}
            disabled={quotaExhausted}
            onClick={() =>
              onToast(
                (t) => isAdmin
                  ? t("orgMembersPreview.approvalToast")
                  : t("orgMembersPreview.invitedToast", { role: t(`role.${role}`) }),
              )
            }
            data-testid="members-invite-submit"
          >
            {isAdmin ? t("orgMembersPreview.submitApproval") : t("orgMembersPreview.sendInvite")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("orgMembersPreview.email")} id="members-invite-email" placeholder="name@company.com" data-testid="members-invite-email" />

        <div className="flex flex-col gap-1.5">
          <Label>{t("orgMembersPreview.orgRole")}</Label>
          <div className="flex flex-wrap gap-1.5" data-testid="members-invite-role">
            {ORG_ROLES_INVITABLE.map((r) => (
              <Button key={r} size="xs" variant={role === r ? "primary" : "outline"} onClick={() => setRole(r)} data-testid="members-invite-role-option">
                {t(`role.${r}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* 管理员高影响提示（O-28 ⑥ 双人复核） */}
        {isAdmin && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid="members-invite-admin-warn">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-11">
              {t("orgMembersPreview.adminWarning")}
            </p>
          </div>
        )}

        {/* 配额用尽硬阻断（O-29 ⑤） */}
        {quotaExhausted && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid="members-invite-quota-block">
            <Ban aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex flex-col gap-1.5 text-11">
              <p>{t("orgMembersPreview.quotaWarning")}</p>
              <Button size="xs" variant="outline" className="self-start" onClick={() => onToast((t) => t("orgMembersPreview.adjusted"))} data-testid="members-invite-quota-adjust">{t("orgMembersPreview.adjust")}</Button>
            </div>
          </div>
        )}

        <p className="text-10 text-muted-foreground">
          {t("orgMembersPreview.security")}
        </p>
      </div>
    </AdminModal>
  );
}

function MemberStatusBadge({ status, sentDays }: { status: MemberStatus; sentDays?: number }) {
  const { t } = useI18n();
  const tone = status === "active" ? "primary" : status === "send-failed" ? "danger" : status === "revoked" || status === "expired" ? "outline" : "warning";
  const suffix = status === "pending" && sentDays ? t("orgMembersPreview.sentDays", { days: sentDays }) : status === "expired" && sentDays ? t("orgMembersPreview.expiredDays", { days: sentDays }) : "";
  return <Badge tone={tone} data-testid={`members-status-${status}`}>{t(`orgMembersPreview.status.${status}`)}{suffix}</Badge>;
}
