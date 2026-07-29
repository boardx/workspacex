"use client";
import * as React from "react";
import { Copy, QrCode, Send, RotateCcw, Ban, Link2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog, Toast } from "@/components/admin/panel";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL } from "@/lib/identity";
import { OrgAdminFrame } from "./org-admin-frame";
import {
  PARTICIPANTS, PARTICIPANT_CONFIRMED, PARTICIPANT_TOTAL,
  ENTRY_IDENTITIES, LINK_EXPIRY, MAIN_LINK, INVITE_CODE, AUTH_POLICY,
  GROUP_LINKS, GROUP_LINK_STATUS_LABEL, ROSTER_PRESENT,
  type GroupLink, type LinkExpiry,
} from "@/lib/mock/org-admin";

/**
 * UC-1.3 载体一 · 项目 → 设置 → 参与者与邀请（管理面）
 *
 * 逐项照录 R8：参与者名单（9/12 已确认）+ 身份四选 + 主链接 + 有效期三档 + 邀请码 +
 * 群发 + 重置全部 + 分组链接（O-06 带一次性令牌）+ 单条撤销 + 重发 + 使用者记录。
 * 撤销 / 重置全部是**高影响动作**：二次确认 + 影响范围说明（R8 推荐交互）。
 */
export function InvitesScreen({ state, previewRole }: { state: UiState; previewRole: ProjectRole }) {
  const [identity, setIdentity] = React.useState<ProjectRole>("member");
  const [expiry, setExpiry] = React.useState<LinkExpiry>("24h");
  const [revoking, setRevoking] = React.useState<GroupLink | null>(null);
  const [resetAll, setResetAll] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  // 组长只读本组链接、不可撤销/重置（R5）；组员/观察者不可见管理入口 → 无权限态
  const canManage = previewRole === "facilitator";
  const denial = canManage
    ? { layer: "project" as const, reason: "组长可查看本组链接与到场，但不可撤销 / 重置；组员与观察者不可见链接管理入口。" }
    : { layer: "project" as const, reason: previewRole === "groupLead"
        ? "你是组长：可看本组加入链接与本组到场，撤销 / 重置 / 别组链接对你不可见。"
        : "邀请与链接管理仅引导师可见。你以「" + PROJECT_ROLE_LABEL[previewRole] + "」身份进入，此屏对你关闭。" };

  return (
    <OrgAdminFrame
      state={state}
      uc="UC-1.3 R8 载体一"
      title="参与者与邀请"
      intro={`${PARTICIPANT_CONFIRMED} / ${PARTICIPANT_TOTAL} 已确认 · 打开即带身份进场，不需要提前注册。链接身份以服务端为准，篡改无效。`}
      emptyHint="还没有参与者。用「邮箱或手机号，逗号分隔」批量邀请，或分发主链接 / 邀请码。"
      errors={{ "invite-input": "第 3 项「13800000000abc」不是合法邮箱或手机号；其余 2 项已受理，请改正后重提该项。" }}
      depFailure="短信 / 邮件送达服务暂不可用：名单与链接可看，群发与重发已暂停并保留输入，稍后可重试。"
      denial={denial}
      successMessage="已群发 12 封邀请；3 项送达失败已单独列出可重试，未呈现为整批成功。"
      skeletonRows={6}
    >
      <div className="flex flex-col gap-5">
        {/* 参与者名单 */}
        <section className="flex flex-col gap-2" data-testid="invites-participants">
          <div className="flex items-center gap-1.5">
            <UserRound aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">参与者</h2>
            <span className="text-11 text-muted-foreground">· {PARTICIPANT_CONFIRMED} / {PARTICIPANT_TOTAL} 已确认</span>
          </div>

          {/* 邀请输入框 + 身份四选 */}
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-56 flex-1 flex-col gap-1">
                <Label htmlFor="invite-input">邀请</Label>
                <Input id="invite-input" placeholder="邮箱或手机号，逗号分隔" data-testid="invites-input" />
              </div>
              <Button size="sm" variant="primary" onClick={() => setToast("已受理 3 位受邀人，写入名单为「邀请已发」")} data-testid="invites-add">邀请</Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="invites-identity-picker">
              <span className="text-11 text-muted-foreground">身份四选：</span>
              {ENTRY_IDENTITIES.map((it) => (
                <Button
                  key={it.key}
                  size="xs"
                  variant={identity === it.key ? "primary" : "outline"}
                  onClick={() => setIdentity(it.key)}
                  data-testid="invites-identity-option"
                  title={it.note}
                >
                  {it.label}
                </Button>
              ))}
            </div>
            {identity === "facilitator" && (
              <p className="text-10 text-muted-foreground" data-testid="invites-cofac-note">
                协同引导师 ＝ 以引导师身份加入（O-03：权限与引导师逐项相同，落库即 facilitator，不新增第五种角色）
              </p>
            )}
          </div>

          {/* 名单行 */}
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {PARTICIPANTS.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2" data-testid="invites-participant-row">
                <span className="w-16 shrink-0 text-13 font-medium">{p.name}</span>
                <Badge tone={p.role === "observer" ? "outline" : "neutral"}>{PROJECT_ROLE_LABEL[p.role]}</Badge>
                <span className="w-16 text-11 text-muted-foreground">{p.group ?? "—"}</span>
                <span className="ml-auto text-11">
                  {p.status === "confirmed"
                    ? <span className="text-success">已确认</span>
                    : <span className="text-muted-foreground">邀请已发 {p.sentDays} 天</span>}
                </span>
                {p.status === "invited" && (
                  <Button size="xs" variant="outline" disabled={!canManage} onClick={() => setToast(`已重发给 ${p.name}，旧链接已失效（冷却 ${AUTH_POLICY.resendCooldownSeconds} 秒 / 每日 ${AUTH_POLICY.resendDailyMax} 次）`)} data-testid="invites-resend">重发</Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* 主链接卡片 */}
        <section className="flex flex-col gap-2" data-testid="invites-main-link">
          <div className="flex items-center gap-1.5">
            <Link2 aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">邀请链接</h2>
            <span className="text-11 text-muted-foreground">· 打开即带身份进场，不需要提前注册</span>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-sm bg-muted px-2 py-1 text-12">{MAIN_LINK}</code>
                <Button size="xs" variant="outline" onClick={() => setToast("已复制主链接")} data-testid="invites-main-copy"><Copy aria-hidden className="h-3 w-3" /> 复制</Button>
                <Button size="xs" variant="outline" onClick={() => setToast("二维码已生成（可放大投屏）")} data-testid="invites-main-qr"><QrCode aria-hidden className="h-3 w-3" /> 二维码</Button>
              </div>

              <div className="flex flex-col gap-1">
                <Label>进场身份</Label>
                <div className="flex flex-wrap gap-1.5" data-testid="invites-main-identity">
                  {ENTRY_IDENTITIES.map((it) => (
                    <Button key={it.key} size="xs" variant={identity === it.key ? "primary" : "outline"} onClick={() => setIdentity(it.key)} data-testid="invites-main-identity-option">{it.label}</Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label>有效期</Label>
                <div className="flex flex-wrap gap-1.5" data-testid="invites-expiry">
                  {LINK_EXPIRY.map((e) => (
                    <Button key={e.key} size="xs" variant={expiry === e.key ? "primary" : "outline"} onClick={() => setExpiry(e.key)} data-testid="invites-expiry-option">{e.label}</Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-11 text-muted-foreground">邀请码（{AUTH_POLICY.inviteCodeLength} 位，与链接等效）</span>
                <code className="rounded-sm bg-muted px-2 py-1 text-12 tracking-wider" data-testid="invites-code">{INVITE_CODE}</code>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Button size="sm" variant="primary" onClick={() => setToast("已群发邀请：按名单批量发出，逐条记录送达结果")} data-testid="invites-broadcast"><Send aria-hidden className="h-3.5 w-3.5" /> 群发邀请</Button>
                <Button size="sm" variant="destructive" disabled={!canManage} onClick={() => setResetAll(true)} data-testid="invites-reset-all"><RotateCcw aria-hidden className="h-3.5 w-3.5" /> 重置全部</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 分组链接 */}
        <section className="flex flex-col gap-2" data-testid="invites-group-links">
          <h2 className="text-14 font-semibold">分组链接<span className="ml-1 text-11 font-normal text-muted-foreground">（打开直接进本组工作台 · O-06 统一带一次性令牌，记录使用者）</span></h2>
          <ul className="flex flex-col gap-2">
            {GROUP_LINKS.map((g) => (
              <li key={g.groupNo} className="flex flex-col gap-1 rounded-lg border border-border p-3" data-testid="invites-group-link-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-medium">{g.groupName}</span>
                  <LinkStatusBadge status={g.status} />
                  <span className="text-10 text-muted-foreground">{LINK_EXPIRY.find((e) => e.key === g.expiry)?.label}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-sm bg-muted px-2 py-0.5 text-11">{g.url}</code>
                  <Button size="xs" variant="outline" onClick={() => setToast(`已复制第 ${g.groupNo} 组链接`)} data-testid="invites-group-copy"><Copy aria-hidden className="h-3 w-3" /> 复制</Button>
                  <Button size="xs" variant="outline" onClick={() => setToast("二维码已生成")} data-testid="invites-group-qr"><QrCode aria-hidden className="h-3 w-3" /> 二维码</Button>
                  {g.status === "valid" && (
                    <Button size="xs" variant="ghost" disabled={!canManage} className="text-destructive" onClick={() => setRevoking(g)} data-testid="invites-group-revoke"><Ban aria-hidden className="h-3 w-3" /> 单独撤销</Button>
                  )}
                </div>
                {/* 一次性链接使用者记录（R7/V4；[待确认] 呈现位置——此处置于链接卡片下） */}
                {g.usedBy && (
                  <p className="text-10 text-muted-foreground" data-testid="invites-group-usedby">
                    一次性令牌已被 <strong className="text-background-foreground">{g.usedBy.name}</strong> 使用 · {g.usedBy.at}
                    <span className="ml-1 rounded-sm border border-border px-1 text-9">[待确认] 呈现位置：名单行内 / 链接卡片下 / 仅审计流水</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* 单条撤销：高影响动作，二次确认 + 影响范围 */}
      {revoking && (
        <ConfirmDialog
          testid="invites-revoke-dialog"
          title={`撤销「${revoking.groupName}」的加入链接？`}
          tone="destructive"
          confirmLabel="撤销该链接"
          requireReason
          reasonPlaceholder="撤销原因（写入审计，如：链接外泄 / 换人）"
          impact={
            <div className="flex flex-col gap-1">
              <p>撤销<strong>作用于该条链接的一次性令牌</strong>（O-06）。影响范围：</p>
              <p>· 已在场的 <strong>{ROSTER_PRESENT}</strong> 人<strong>不会被踢出</strong>，其会话保留至当前议程环节结束，环节切换后失效。</p>
              <p>· 该链接的<strong>新访问将在 5 秒内失效</strong>（AC2），进场者会看到「找引导师重发」。</p>
              <p>· 需要立刻断开所有人请改用「重置全部」或逐人移出（立即生效）。</p>
            </div>
          }
          onCancel={() => setRevoking(null)}
          onConfirm={() => { setToast(`已撤销第 ${revoking.groupNo} 组链接的令牌；新访问 5 秒内失效，已记入审计`); setRevoking(null); }}
        />
      )}

      {/* 重置全部：更高影响 */}
      {resetAll && (
        <ConfirmDialog
          testid="invites-reset-dialog"
          title="重置全部链接？"
          tone="destructive"
          confirmLabel="作废全部链接"
          requireReason
          reasonPlaceholder="重置原因（写入审计）"
          impact={
            <div className="flex flex-col gap-1">
              <p>一次性作废<strong>全部 {GROUP_LINKS.length} 条分组链接 + 主链接 + 邀请码</strong>。</p>
              <p>· 已在场的 {ROSTER_PRESENT} 人不会被踢出，会话保留至当前环节结束。</p>
              <p>· 所有链接的新访问立即失效，需重新签发并分发。</p>
            </div>
          }
          onCancel={() => setResetAll(false)}
          onConfirm={() => { setToast("已重置全部链接；请重新签发并分发，已记入审计"); setResetAll(false); }}
        />
      )}

      <Toast message={toast} testid="invites-toast" onDismiss={() => setToast(null)} />
    </OrgAdminFrame>
  );
}

function LinkStatusBadge({ status }: { status: GroupLink["status"] }) {
  const tone = status === "valid" ? "primary" : status === "revoked" ? "danger" : status === "expired" ? "warning" : "neutral";
  return <Badge tone={tone} data-testid="invites-group-status">{GROUP_LINK_STATUS_LABEL[status]}</Badge>;
}
