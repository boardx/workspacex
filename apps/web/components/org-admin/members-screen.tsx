"use client";
import * as React from "react";
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
  ORG_MEMBERS, ORG_MEMBER_TOTAL, ORG_MEMBER_ACTIVE, MEMBER_STATUS_LABEL,
  QUOTA_OVERVIEW, ADMIN_APPROVAL_QUEUE, ORG_ROLES_INVITABLE, ORG_ROLE_LABEL,
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
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [quotaExhausted, setQuotaExhausted] = React.useState(false);
  const [revoking, setRevoking] = React.useState<OrgMemberRow | null>(null);
  const [removing, setRemoving] = React.useState<OrgMemberRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

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
      title="成员与配额"
      intro={`${ORG_MEMBER_TOTAL} 位成员 · 活跃 ${ORG_MEMBER_ACTIVE}/${ORG_MEMBER_TOTAL} · 产品是邀请制的：只能被邀请入组织，不存在自助加入路径。`}
      emptyHint="新组织只有创建者一人。点「邀请成员」把第二个人请进来（承接 UC-1.5）。"
      errors={{ "invite-email": "该邮箱已是本组织成员，不重复创建；已把入口引导到「直接登录」（E2）。" }}
      depFailure="邮件服务不可用：邀请记录已标「发送失败」并保留，可重试；不产生可激活的链接假象（E6）。"
      denial={{ layer: "organization", reason: "「成员与配额」仅组织管理员可进。项目负责人 / 顾问不进后台，其项目内邀请走 UC-1.3（不产生组织成员）。" }}
      successMessage="陈默 已激活：成员表出现「顾问 · 供应链组」，活跃成员计数 +1，配额总览同步刷新。"
      skeletonRows={6}
    >
      <div className="flex flex-col gap-5">
        {/* 顶部动作 + 配额总览 + 硬阻断演示开关 */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => setInviteOpen(true)} data-testid="members-invite-open" disabled={!canAdmin}>
              <UserPlus aria-hidden className="h-3.5 w-3.5" /> 邀请成员
            </Button>
            <Button size="sm" variant="outline" onClick={() => setToast("已导出成员与配额 CSV")} data-testid="members-export">导出</Button>
            <label className="ml-auto flex items-center gap-1.5 text-10 text-muted-foreground">
              <input type="checkbox" checked={quotaExhausted} onChange={(e) => setQuotaExhausted(e.currentTarget.checked)} data-testid="members-quota-toggle" className="h-3.5 w-3.5 rounded-sm border border-input" />
              演示：把未分配额度置零（触发硬阻断）
            </label>
          </div>
          <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-panel p-3 text-11" data-testid="members-quota-overview">
            <span>已分配 <strong>{QUOTA_OVERVIEW.allocatedM.toLocaleString()} 万</strong>（占组织额度 {QUOTA_OVERVIEW.allocatedPct}%）</span>
            <span className="text-muted-foreground">｜</span>
            <span>未分配 <strong>{quotaExhausted ? "0" : QUOTA_OVERVIEW.unallocatedM.toLocaleString()} 万</strong>{quotaExhausted ? "（已用尽）" : "（建议留作应急池）"}</span>
            {quotaExhausted && <Badge tone="danger" data-testid="members-quota-exhausted">配额用尽 · 新邀请将被硬阻断</Badge>}
          </div>
        </section>

        {/* 双人复核待批队列（O-28 ⑥） */}
        {ADMIN_APPROVAL_QUEUE.length > 0 && (
          <section className="flex flex-col gap-2" data-testid="members-approval-queue">
            <div className="flex items-center gap-1.5">
              <ShieldAlert aria-hidden className="h-4 w-4 text-warning" />
              <h2 className="text-14 font-semibold">管理员邀请 · 双人复核待批</h2>
              <Badge tone="warning">发起人不可自批</Badge>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-warning/30 bg-warning/5">
              {ADMIN_APPROVAL_QUEUE.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="members-approval-row">
                  <span className="text-12 font-medium">{a.email}</span>
                  <Badge tone="danger">管理员</Badge>
                  <span className="text-11 text-muted-foreground">由 {a.requestedBy} 发起 · {a.at}</span>
                  <div className="ml-auto flex gap-1.5">
                    <Button size="xs" variant="primary" onClick={() => setToast("已批准：现在才签发激活链接（发起人此前无法自批）")} data-testid="members-approve">批准</Button>
                    <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setToast("已拒绝该管理员邀请，未签发链接")} data-testid="members-approval-reject">拒绝</Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 成员表 */}
        <section className="flex flex-col gap-2" data-testid="members-table">
          <h2 className="text-14 font-semibold">成员 · 角色 · 状态</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {ORG_MEMBERS.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="members-row">
                <span className="w-16 shrink-0 text-13 font-medium">{m.name}</span>
                <Badge tone={m.role === "admin" ? "danger" : "neutral"}>
                  {ORG_ROLE_LABEL[m.role]}{m.status !== "active" ? "（待激活）" : ""}
                </Badge>
                {m.external && (
                  <Badge tone="outline" data-testid="members-external-tag">客户方 · 外部</Badge>
                )}
                <span className="w-20 text-11 text-muted-foreground">{m.usedM.toFixed(1)}/{m.limitM.toFixed(1)}M</span>
                <MemberStatusBadge status={m.status} sentDays={m.sentDays} />
                <div className="ml-auto flex gap-1.5">
                  {(m.status === "pending" || m.status === "send-failed" || m.status === "expired") && (
                    <>
                      <Button size="xs" variant="outline" disabled={!canAdmin} onClick={() => setToast(`已重发给 ${m.name}，旧链接立即失效（冷却 ${AUTH_POLICY.resendCooldownSeconds} 秒 / 每日 ${AUTH_POLICY.resendDailyMax} 次）`)} data-testid="members-resend">
                        <RefreshCw aria-hidden className="h-3 w-3" /> 重发
                      </Button>
                      <Button size="xs" variant="ghost" disabled={!canAdmin} className="text-destructive" onClick={() => setRevoking(m)} data-testid="members-revoke">
                        <Ban aria-hidden className="h-3 w-3" /> 撤销
                      </Button>
                    </>
                  )}
                  {m.status === "active" && m.role !== "admin" && (
                    <Button size="xs" variant="ghost" disabled={!canAdmin} className="text-destructive" onClick={() => setRemoving(m)} data-testid="members-remove">
                      <UserMinus aria-hidden className="h-3 w-3" /> 移除
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-10 text-muted-foreground">待激活成员计入名册但不计入活跃成员（{ORG_MEMBER_ACTIVE}/{ORG_MEMBER_TOTAL}）。撤销 / 移除均写审计并显示影响范围。</p>
        </section>
      </div>

      {/* 邀请成员弹层 */}
      {inviteOpen && (
        <InviteMemberDialog
          quotaExhausted={quotaExhausted}
          onClose={() => setInviteOpen(false)}
          onToast={(m) => { setToast(m); setInviteOpen(false); }}
        />
      )}

      {/* 撤销未接受的邀请 */}
      {revoking && (
        <ConfirmDialog
          testid="members-revoke-dialog"
          title={`撤销对 ${revoking.name} 的邀请？`}
          tone="destructive"
          confirmLabel="撤销邀请"
          impact={
            <div className="flex flex-col gap-1">
              <p>立即作废其激活令牌，成员表移除该行。此邀请尚未激活，不涉及历史产出。</p>
              <p>该链接被再次点开将看到「该邀请已失效，请联系管理员重发」（不区分具体原因，防枚举）。</p>
            </div>
          }
          onCancel={() => setRevoking(null)}
          onConfirm={() => { setToast(`已撤销对 ${revoking.name} 的邀请；链接立即失效，事件已审计`); setRevoking(null); }}
        />
      )}

      {/* 移除成员（O-29 ②：停用访问，保留署名与历史产出） */}
      {removing && (
        <ConfirmDialog
          testid="members-remove-dialog"
          title={`移除成员 ${removing.name}？`}
          tone="destructive"
          confirmLabel="移除并停用访问"
          requireReason
          reasonPlaceholder="移除原因（写入审计，如：离职）"
          impact={
            <div className="flex flex-col gap-1">
              <p>移除 ＝ <strong>停用其访问，不删除其历史产出</strong>（与授权撤回 UC-17.2 是两条不同路径）。</p>
              <p>· 立即吊销其全部会话与未接受的邀请；</p>
              <p>· 其便签 / 产出 / 签署记录<strong>保留且署名保留</strong>，界面显示「已离职」标记（不匿名化，保住可问责）；</p>
              <p>· 释放其配额（{removing.limitM.toFixed(1)}M）回组织池；</p>
              <p>· 写审计并显示影响范围（他还负责着哪些未完成任务）。</p>
            </div>
          }
          onCancel={() => setRemoving(null)}
          onConfirm={() => { setToast(`已移除 ${removing.name}：会话已吊销、配额已释放、历史产出保留并标「已离职」`); setRemoving(null); }}
        />
      )}

      <Toast message={toast} testid="members-toast" onDismiss={() => setToast(null)} />
    </OrgAdminFrame>
  );
}

/* ── 邀请成员弹层：邮箱 + 角色三选 + 双人复核 + 配额硬阻断 ─────────── */

function InviteMemberDialog({
  quotaExhausted, onClose, onToast,
}: {
  quotaExhausted: boolean;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [role, setRole] = React.useState<OrgRole>("consultant");
  const isAdmin = role === "admin";

  return (
    <AdminModal
      testid="members-invite-dialog"
      title="邀请成员"
      subtitle="发一条「带组织与角色的一次性链接」；入场即带好组织角色。"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="members-invite-cancel">取消</Button>
          <Button
            size="sm"
            variant={isAdmin ? "destructive" : "primary"}
            disabled={quotaExhausted}
            onClick={() =>
              onToast(
                isAdmin
                  ? "邀请管理员需双人复核：已进入待批队列，另一名管理员批准后才签发链接（你不可自批）"
                  : `已邀请：${ORG_ROLE_LABEL[role]}，激活链接已发出（有效期见「激活落地页」屏）`,
              )
            }
            data-testid="members-invite-submit"
          >
            {isAdmin ? "提交双人复核" : "发送邀请"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="工作邮箱" id="members-invite-email" placeholder="name@company.com" data-testid="members-invite-email" />

        <div className="flex flex-col gap-1.5">
          <Label>组织角色</Label>
          <div className="flex flex-wrap gap-1.5" data-testid="members-invite-role">
            {ORG_ROLES_INVITABLE.map((r) => (
              <Button key={r} size="xs" variant={role === r ? "primary" : "outline"} onClick={() => setRole(r)} data-testid="members-invite-role-option">
                {ORG_ROLE_LABEL[r]}
              </Button>
            ))}
          </div>
        </div>

        {/* 管理员高影响提示（O-28 ⑥ 双人复核） */}
        {isAdmin && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid="members-invite-admin-warn">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-11">
              授予后台全部配置权是<strong>高影响提权动作</strong>。需<strong>另一名现有管理员批准</strong>后才生效，
              发起人不可自批。组织内仅一名管理员时转为待批队列（需平台运营方协助），不退化为单人可批。
            </p>
          </div>
        )}

        {/* 配额用尽硬阻断（O-29 ⑤） */}
        {quotaExhausted && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid="members-invite-quota-block">
            <Ban aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex flex-col gap-1.5 text-11">
              <p>剩余未分配额度不足，<strong>邀请已硬阻断</strong>。请先调整现有成员配额或联系平台方扩容。</p>
              <Button size="xs" variant="outline" className="self-start" onClick={() => onToast("已跳转到成员配额调整")} data-testid="members-invite-quota-adjust">去调整配额</Button>
            </div>
          </div>
        )}

        <p className="text-10 text-muted-foreground">
          链接携带组织 + 角色，<strong>以服务端为准，篡改无效</strong>（AC5）。激活链接一次性、有有效期（见「激活落地页」屏）。
        </p>
      </div>
    </AdminModal>
  );
}

function MemberStatusBadge({ status, sentDays }: { status: MemberStatus; sentDays?: number }) {
  const tone = status === "active" ? "primary" : status === "send-failed" ? "danger" : status === "revoked" || status === "expired" ? "outline" : "warning";
  const suffix = status === "pending" && sentDays ? ` · 已发送 ${sentDays} 天` : status === "expired" && sentDays ? ` · ${sentDays} 天前` : "";
  return <Badge tone={tone} data-testid={`members-status-${status}`}>{MEMBER_STATUS_LABEL[status]}{suffix}</Badge>;
}
