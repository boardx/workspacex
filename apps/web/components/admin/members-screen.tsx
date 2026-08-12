"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, EyeOff, ScrollText, FileClock, Gauge, UserPlus } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { NoBackendNotice } from "./no-backend-notice";
import { AdminDrawer, AdminModal, Toast, Field } from "./panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UsageMonitorTab } from "./usage-monitor-tab";
import { LimitPolicyTab } from "./limit-policy-tab";
import { MemberQuotaTab } from "./member-quota-tab";
import { AdminBoundaryLive } from "./admin-boundary-live";
import {
  MEMBERS, ADMIN_ACCESS_LOGS, ADMIN_PROJECT_ACCESS_COUNT, type MemberRow,
} from "@/lib/mock/admin";
/**
 * F10：待激活行与 `[邀请成员]` 入口的数据取自 `lib/mock/org-admin.ts`，
 * **不在这里再抄一份成员名单**。
 *
 * ⚠ 这一层仍有一处既存的重复：本屏的配额区读 `lib/mock/admin.MEMBERS`（F06 的），
 *   而邀请/待激活区读 `lib/mock/org-admin.ORG_MEMBERS`（原型那份）。
 *   两份名单的**人**不一样，所以现在不是同一事实的两个副本；但它们迟早会被要求一致。
 *   这一点作为发现记在这里，收敛属于 F11（成员表整并）的范围，不在 F10 里顺手做。
 */
import {
  ORG_MEMBERS, ORG_MEMBER_ACTIVE, ORG_MEMBER_TOTAL, ORG_ROLES_INVITABLE, TEAMS,
  MEMBER_STATUS_LABEL, type MemberStatus, type OrgMemberRow, type Team,
} from "@/lib/mock/org-admin";
import { ORG_ROLE_LABEL, type OrgRole } from "@/lib/identity";
import type { UiState } from "@/lib/ui-state";

function quotaTone(pct: number): "primary" | "warning" | "destructive" {
  if (pct >= 95) return "destructive";
  if (pct >= 80) return "warning";
  return "primary";
}

/**
 * 待激活行 = 名单里**不是** `active` 的那些。
 *
 * ⚠ 写成「非 active」而不是「status === 'pending'」：`send-failed` / `expired` / `revoked`
 * 三种同样是「还没进场的人」，而且恰恰是最需要管理员看见的三种。
 * 只列 `pending` 会让一条发送失败的邀请从界面上消失，而它在库里还占着名额。
 */
const PENDING_MEMBERS: OrgMemberRow[] = ORG_MEMBERS.filter((m) => m.status !== "active");

function PendingStatusBadge({ status, sentDays }: { status: MemberStatus; sentDays?: number }) {
  const tone =
    status === "send-failed" ? "danger" : status === "revoked" || status === "expired" ? "outline" : "warning";
  const suffix =
    status === "pending" && sentDays ? ` · 已发送 ${sentDays} 天` : status === "expired" && sentDays ? ` · ${sentDays} 天前` : "";
  // 文案读 `MEMBER_STATUS_LABEL`，不在这里重写一遍——它已经是那份枚举的单一事实源。
  return (
    <Badge tone={tone} data-testid={`admin-member-status-${status}`}>
      {MEMBER_STATUS_LABEL[status]}
      {suffix}
    </Badge>
  );
}

/** 三个并列 tab —— 原型（`WorkspaceX Standalone.html` 偏移 15851070/298/527）证实是
 * 同一屏三按钮，不是三个独立左栏菜单项，因此不新增 `AdminModuleKey`。 */
type MembersTabKey = "quota" | "usage" | "policy";

export function MembersScreen({ state }: { state: UiState }) {
  const [tab, setTab] = React.useState<MembersTabKey>("quota");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteRole, setInviteRole] = React.useState<OrgRole>("consultant");
  const [inviteTeam, setInviteTeam] = React.useState<Team>(TEAMS[0]);
  const [limits, setLimits] = React.useState<Record<string, number>>({});
  const [quotaOf, setQuotaOf] = React.useState<MemberRow | null>(null);
  const [newLimit, setNewLimit] = React.useState("");
  const [accessOpen, setAccessOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const openQuota = (m: MemberRow) => { setQuotaOf(m); setNewLimit((limits[m.id] ?? m.limitM).toFixed(1)); };

  return (
    <AdminScreen
      state={state}
      moduleLabel="成员配额"
      title="成员与配额"
      /* F160：整屏级的「尚未接入真实后端」摘掉——「成员配额」这一 tab 已经读真库。
         但「另外两个 tab 仍然是 mock」（用量监控 F161 / 限额策略 F162 未做），
         所以那条提示搬进那两个 tabpanel 里，按 tab 说实话。
         整屏一刀切地摘掉会让还在骗人的两个 tab 混进「已接线」的观感。 */
      intro="管理员不是超级用户。你能看到每个人的用量与个人层「条目数」，但看不到个人层的内容——这一层是三层记忆里唯一对管理员封闭的一层。团队/名册/邀请的完整管理在「组织成员」（下方链接，已接真实后端）；本屏只做配额与「管理员看不到什么」这两块，两者不是同一功能。"
      emptyHint="组织里还没有成员"
      errors={{ quota: "提额失败：目标额度超过组织剩余额度（1,380 万 tokens），请先调整组织总额度" }}
      depFailure="用量统计依赖计量流水线（UC-17.7）；流水线不可用，配额与个人层计数无法刷新。"
      denialReason="成员与配额仅组织管理员可见；顾问只能通过『看我的访问记录』查看自己的访问历史。"
      successMessage="已为吴桐单独提额至 5.0M；本次操作已记入审计"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as MembersTabKey)} data-testid="admin-members-tabs">
        <TabsList>
          <TabsTrigger value="quota" data-testid="admin-members-tab-quota">成员配额</TabsTrigger>
          <TabsTrigger value="usage" data-testid="admin-members-tab-usage">用量监控</TabsTrigger>
          <TabsTrigger value="policy" data-testid="admin-members-tab-policy">限额策略</TabsTrigger>
        </TabsList>

        {/* F161 起「用量监控」读真库，整块的 NoBackendNotice 摘掉；
            该 tab 内部仍是 mock 的那一小块（近期限额事件）自己带着提示，见其组件。 */}
        <TabsContent value="usage" data-testid="admin-members-tabpanel-usage">
          <div className="flex flex-col gap-3 pt-3">
            <UsageMonitorTab />
          </div>
        </TabsContent>

        <TabsContent value="policy" data-testid="admin-members-tabpanel-policy">
          <div className="flex flex-col gap-3 pt-3">
            <NoBackendNotice />
            <LimitPolicyTab />
          </div>
        </TabsContent>

      <TabsContent value="quota" data-testid="admin-members-tabpanel-quota">
      <div className="flex flex-col gap-5">
        {/* 2026-08-11（菜单去重复查）：与「组织成员」（/org-admin/preview，已接真实后端）
            的关系，同 canvas-template-screen.tsx / blueprint-screen.tsx 的「打开 X」链接
            是同一套模式——本屏只做清单展示与去向，团队创建、成员加入/移出、邀请与组织资料
            的完整读写在那一屏。这里的邀请/名册仍是本屏自己的 mock，与那一屏的真实数据不同源，
            两者的「人」目前不保证一致（F11 待收敛）。 */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-12 text-muted-foreground">
              团队创建/改名/删除、真实成员名册与邀请、组织资料在「组织成员」管理（已接真实后端）。
              这里是配额与「管理员看不到什么」这两块——组织级团队/邀请管理不重复做。
            </p>
            <Link
              href="/org-admin/preview"
              data-testid="admin-members-open-org-admin"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
            >
              打开组织成员管理
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* 成员配额列表 —— F160 起改为**真栈**（`MemberQuotaTab`）。
            这里原先是 `lib/mock/admin.MEMBERS` 的 usedM/limitM 两个写死的浮点数；
            根因不在前端，是全仓此前零 token 计量落库（见 F159 的迁移）。 */}
        <MemberQuotaTab />

        <section className="flex flex-col gap-2" data-testid="admin-members-list">
          {/* ── F10 / UC-1.6：邀请入口 + 待激活行 ─────────────────────────
              F160 起配额列表搬进了 `MemberQuotaTab`（真栈），邀请/待激活这块「仍是 mock」
              （`lib/mock/org-admin.ts`）——它属 F11 成员表整并的地盘，本轮不碰
              （coord-main 2026-08-12 裁决第 4 条）。两块因此不再同源：上面的人来自真库，
              这里的人来自 mock，「不保证是同一批人」。这句话必须写在代码里，
              否则这一屏看起来像一张统一的成员表。 */}
          <div className="flex flex-wrap items-center gap-2" data-testid="admin-members-invite-bar">
            <span className="text-11 text-muted-foreground" data-testid="admin-members-roster-count">
              名册 {ORG_MEMBER_TOTAL} 人 · 活跃 {ORG_MEMBER_ACTIVE} 人（待激活计入名册，不计入活跃）
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

          {PENDING_MEMBERS.length > 0 && (
            <Card>
              <CardContent className="flex flex-col divide-y divide-border pt-2">
                {PENDING_MEMBERS.map((m) => (
                  <div
                    key={m.id}
                    data-testid={`admin-member-pending-${m.id}`}
                    className="flex flex-wrap items-center gap-2 py-2"
                  >
                    <span className="w-14 shrink-0 text-13 font-medium">{m.name}</span>
                    {/* 角色徽标带「（待激活）」后缀：这个人已经**被指派了**角色与团队，
                        只是还没进场——两件事在同一行里同时可见，才看得出「入场即带」。 */}
                    <Badge tone={m.role === "admin" ? "danger" : "outline"}>
                      {ORG_ROLE_LABEL[m.role]}（待激活）
                    </Badge>
                    <span className="text-11 text-muted-foreground">{m.team}</span>
                    <PendingStatusBadge status={m.status} sentDays={m.sentDays} />
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => setToast(`已重发给 ${m.name}；旧链接立即失效`)}
                      data-testid={`admin-member-resend-${m.id}`}
                    >
                      重发
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <p className="text-10 text-muted-foreground">
            激活链接一次性、有有效期；链接携带的组织 / 角色 / 团队
            <strong className="text-background-foreground">以服务端为准，篡改无效</strong>。
          </p>
        </section>

        {/* 管理员权力边界（D-18 / UC-17.5）—— F163 起接**既有**真端点
            （GET /identity/personal-layer/summary + GET /admin-access-log/mine，
            两条都是 F06 已 passing 的，此前前端一直没接、读的是 mock）。 */}
        <AdminBoundaryLive />

      </div>
      </TabsContent>
      </Tabs>

      {/* F10：[邀请成员] 弹层 —— 邮箱 + 组织角色三选 + 团队（ui.md 2.2 #15） */}
      {inviteOpen && (
        <AdminModal
          testid="admin-members-invite-dialog"
          title="邀请成员"
          subtitle="发一条一次性激活链接；入场即带好组织角色与团队。"
          onClose={() => setInviteOpen(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setInviteOpen(false)} data-testid="admin-members-invite-cancel">取消</Button>
              <Button
                size="sm"
                variant={inviteRole === "admin" ? "destructive" : "primary"}
                onClick={() => {
                  setToast(
                    inviteRole === "admin"
                      ? "邀请管理员需另一名管理员批准：已进入待批队列，批准前不签发链接（发起人不可自批）"
                      : `已邀请：${ORG_ROLE_LABEL[inviteRole]} · ${inviteTeam}；激活链接已发出`,
                  );
                  setInviteOpen(false);
                }}
                data-testid="admin-members-invite-submit"
              >
                {inviteRole === "admin" ? "提交双人复核" : "发送邀请"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="工作邮箱" id="admin-members-invite-email" placeholder="name@company.com" data-testid="admin-members-invite-email" />
            <div className="flex flex-col gap-1.5">
              <span className="text-11 font-medium text-muted-foreground">组织角色</span>
              <div className="flex flex-wrap gap-1.5" data-testid="admin-members-invite-role">
                {ORG_ROLES_INVITABLE.map((r) => (
                  <Button key={r} size="xs" variant={inviteRole === r ? "primary" : "outline"} onClick={() => setInviteRole(r)} data-testid={`admin-members-invite-role-${r}`}>
                    {ORG_ROLE_LABEL[r]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-11 font-medium text-muted-foreground">团队</span>
              <div className="flex flex-wrap gap-1.5" data-testid="admin-members-invite-team">
                {TEAMS.map((t) => (
                  <Button key={t} size="xs" variant={inviteTeam === t ? "primary" : "outline"} onClick={() => setInviteTeam(t)} data-testid="admin-members-invite-team-option">
                    {t}
                  </Button>
                ))}
              </div>
              <p className="text-10 text-muted-foreground">一人一队（组织内单一归属，O-12）。</p>
            </div>
            {inviteRole === "admin" && (
              <div className="flex flex-col gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-11" data-testid="admin-members-invite-admin-warn">
                <p>
                  授予后台全部配置权是<strong className="text-background-foreground">高影响提权动作</strong>：
                  需另一名现有管理员批准后才签发链接，<strong className="text-background-foreground">发起人不可自批</strong>。
                  组织内仅一名管理员时停在待批队列（需平台运营方协助），不退化为单人可批。
                </p>
              </div>
            )}
          </div>
        </AdminModal>
      )}

      {/* 单独提额 */}
      {quotaOf && (
        <AdminModal
          testid="admin-member-quota-dialog"
          title={`给 ${quotaOf.name} 单独提额`}
          subtitle={`当前 ${quotaOf.usedM.toFixed(1)}/${(limits[quotaOf.id] ?? quotaOf.limitM).toFixed(1)}M · ${quotaOf.orgRole} · ${quotaOf.team}`}
          onClose={() => setQuotaOf(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setQuotaOf(null)} data-testid="admin-member-quota-cancel">取消</Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const v = parseFloat(newLimit);
                  if (!Number.isFinite(v) || v <= 0) return;
                  setLimits((p) => ({ ...p, [quotaOf.id]: v }));
                  setToast(`已为 ${quotaOf.name} 单独提额至 ${v.toFixed(1)}M；本次操作已记入审计`);
                  setQuotaOf(null);
                }}
                data-testid="admin-member-quota-save"
              >
                确认提额
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field
              id="admin-member-quota-input"
              label="新的月度额度（百万 token）"
              type="number"
              value={newLimit}
              onChange={(e) => setNewLimit(e.currentTarget.value)}
            />
            <p className="text-11 text-muted-foreground">
              提额不会绕过个人层封闭：即便你调高他的额度，仍看不到他个人层的内容，只看得到计数与用量。
            </p>
          </div>
        </AdminModal>
      )}

      {/* 我的访问记录抽屉 */}
      {accessOpen && (
        <AdminDrawer testid="admin-members-access-drawer" title="我的项目层访问记录" subtitle="每一条都对该项目负责人可见，不可删除" onClose={() => setAccessOpen(false)}>
          <div className="flex flex-col gap-2" data-testid="admin-members-access-full">
            <p className="text-11 text-muted-foreground">本月共 {ADMIN_ACCESS_LOGS.length} 次升到项目层读取内容。升项目层是获取内容的唯一路径。</p>
            {ADMIN_ACCESS_LOGS.map((log) => (
              <div key={log.id} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="admin-members-access-item">
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{log.project}</span>
                  <Badge tone="primary">对负责人 {log.lead} 可见</Badge>
                  <span className="ml-auto text-11 text-muted-foreground">{log.when}</span>
                </div>
                <p className="text-11 text-muted-foreground">读取范围：项目库文档与转写（不含任何成员个人层）。理由已随访问写入审计。</p>
              </div>
            ))}
          </div>
        </AdminDrawer>
      )}

      <Toast message={toast} testid="admin-members-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}
