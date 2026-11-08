"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { translate, type MessageKey, type MessageParams } from "@/lib/i18n/messages";
import { describeFailure } from "@/lib/design-failure";
import type { Locale } from "@/lib/i18n/locale";
type Translator = (key: MessageKey, params?: MessageParams) => string;
type Feedback = (t: Translator, locale?: Locale) => string;
type LocalizedNotice = { tone: "success" | "error"; text: Feedback };
import { AlertTriangle, Ban, Camera, ChevronDown, Copy, Mail, RotateCcw, Send, Settings, UserCog } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { useSession } from "@/components/session/session-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError, apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { invalidateOrgAvatar } from "@/components/shell/org-menu";
import { contractFieldIssues } from "@/lib/auth";
import { buildActivationLink } from "@/lib/activation-link";
import { type OrgRole } from "@/lib/identity";
import { AssignableOrgRole } from "@repo/contracts/identity";
import { auth as authContract } from "@repo/contracts";
import { SharedInviteLinksSection, type SharedLinkReveal } from "@/components/org-admin/shared-invite-links";
import { StandingToolGrantsSection } from "@/components/org-admin/standing-tool-grants";
import { KnowledgeExtractionToggleSection } from "@/components/org-admin/knowledge-extraction-toggle";
import { OrganizationContent, OrganizationPageHeader, OrganizationStatCard } from "./organization-content";
import { cn } from "@/lib/utils";
import {
  listOrgMembers, listOrgInvites,
  setOrgMemberRole,
  updateOrganization, uploadOrgAvatar,
  inviteOrgMember, resendOrgInvite, revokeOrgInvite,
  type ListOrgMembersOut, type ListOrgInvitesOut, type UpdateOrganizationOut,
} from "@/lib/live-org-admin";

/**
 * `/org-admin/*` —— 组织管理三屏（#639 delta 起步 → #363 收拢补齐 → issue #2615 拆平）。
 *
 * ## 并入组织后台左栏（2026-09-03 人类直接反馈）
 * 原话：「在组织的菜单点击组织管理，就是进入到组织后台的菜单，所以需要把他们合并」——
 * 左上角组织菜单的「组织管理」入口（`org-menu.tsx`）此前落到这里时，`AppShell` 没有
 * `left` 栏，点进来是一个和「组织后台」（`/admin`）毫无视觉/结构关联的孤立页面，
 * 与「组织管理＝组织后台的一部分」这个心智模型不符。
 * ⇒ 这三个屏的 `AppShell` 都接上 `AdminNav`，左栏与其余 `/admin/*` 屏一致。
 *
 * ## 拆平为三个独立路由/屏、去掉团队概念（issue #2615，2026-09-03 人类两条原话裁决）
 * 原来单一的 `/org-admin`（`OrgAdminScreen`，内部一套 `Tabs` 套团队/成员/邀请/组织资料
 * 四个标签页）已经拆掉：
 *   ①「在后台的组织后台中，将组织管理下面的成员，邀请，组织资料，编程是和总览平级的
 *     功能」——不再有一层"组织管理"外壳把三者收在一个入口下，而是 `OrgMembersScreen`
 *     / `OrgInvitesScreen` / `OrgProfileScreen` 三个独立导出的屏组件，各自 `AppShell`
 *     套 `AdminNav`（`active` 分别是 `"org-members"`/`"org-invites"`/`"org-profile"`），
 *     各自落在 `/org-admin/members`/`/org-admin/invites`/`/org-admin/profile`，与
 *     `overview`（`/admin`）在 `lib/mock/admin.ts` 的同一个 `items` 数组里平级。
 *     `/org-admin` 根路由重定向到 `/org-admin/members`（见 `app/org-admin/page.tsx`）。
 *   ②「在组织中去掉团队的概念。团队的概念是在项目中的概念，在项目中分为不同的团队」
 *     ——原来的"团队"标签页（`TeamsTab`/`CreateTeamForm`/`TeamRow`，建/改名/删除团队）
 *     整体撤除，`InviteMemberForm` 里"团队"下拉同样撤除（邀请不再要求选团队）。
 *     对应的契约操作（`TeamOp`/`mutateTeam`/`listTeams`/`createTeam`/`renameTeam`/
 *     `deleteTeam`）与后端实现一并移除——`org_memberships.team_id` 这类数据库列本身
 *     不受影响（未改任何 migration/schema，这条是人类的硬约束）。
 *
 * ## 本轮范围（#363 收拢：成员/邀请列表读 + 组织资料编辑）
 * - "成员"屏：真实 `listOrgMembers`——任何组织成员可读（delta §2）。
 * - "邀请"屏：真实 `listOrgInvites`——**仅组织 admin**，权限比"成员"更紧，
 *   非 admin 会看到真实 403 映射出的「无权限」态，不是隐藏入口——隐藏会让人以为
 *   这个功能不存在，而「存在但你看不到」和「不存在」是两件事（UC-0.3 R8）。
 * - "组织资料"屏：仅组织 admin 可见（编辑动作本身就是 admin-only，非 admin 打开
 *   这个屏也读不到内容，`StateShell` 的 `denial` 态负责说清楚）。
 *
 * ⚠ 组织资料**没有独立的读端点**（contract.md 这份 delta 只定义了 `updateOrganization`
 *   一个写操作，`out` 回显新状态，但没有 `getOrganization`）——首次进入"组织资料"屏
 *   时用**不带任何字段的 `updateOrganization({orgId})`调用**当读：本仓后端实现里
 *   `sets.length === 0` 分支是纯 `SELECT`，不写库（`pg-org-profile-repository.ts`）。
 *   这不是新契约操作，是复用同一个已签核操作的"空补丁即读"形状。
 *
 * ⚠ 成员/邀请两个屏此前只有 mock 版本，挂在 `/org-admin/preview?screen=members`/
 *   `?screen=invites`（`org-admin-app.tsx` 的原型切换器，由 admin-nav.tsx 的"成员"
 *   二级导航项进入）。**没有摘除那条导航入口**——它是 ADR-023 的签核材料现行路由
 *   （`.harness/scripts/nav-reachability.config.json` 的 `org-admin` 束），删掉会打红
 *   `lint-nav-reachability.mjs`，且人类在 #700 已经裁决"不删这组入口，只标'原型·待归并'"。
 *   `components/org-admin/members-screen.tsx`/`invites-screen.tsx` 从未真的挂在
 *   `/admin/[module]` 下（那里的 `members` 键指向的是另一个文件
 *   `components/admin/members-screen.tsx`，配额/用量为主，不是本 delta 的对象，
 *   其文件头逐字写着"不改它"）——本轮的真实入口只有 `/org-admin/*` 这三条，不存在
 *   第二套"摘除"的必要。
 */

/** 三个独立屏共用——`AppShell` + `AdminNav` + 标题区的外壳。 */
function OrgAdminShell({
  active, icon: Icon, title, children,
}: {
  active: "org-members" | "org-invites" | "org-profile";
  icon: typeof Settings;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AppShell previewRole={null} left={<AdminNav active={active} />}>
      <OrganizationContent testId="org-admin-screen">
        <OrganizationPageHeader title={title} icon={Icon} />
        {children}
      </OrganizationContent>
    </AppShell>
  );
}

/** `/org-admin/members` —— 成员，与 `/admin`（总览）平级。 */
export function OrgMembersScreen() {
  const { t } = useI18n();
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const isAdmin = identity?.orgRole === "admin";
  return (
    <OrgAdminShell active="org-members" icon={UserCog} title={t("orgMembers.members")}>
      {orgId ? <MembersTab orgId={orgId} isAdmin={isAdmin} /> : <LoadingSkeleton rows={3} />}
    </OrgAdminShell>
  );
}

/** `/org-admin/invites` —— 邀请，与 `/admin`（总览）平级。 */
export function OrgInvitesScreen() {
  const { t } = useI18n();
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const isAdmin = identity?.orgRole === "admin";
  // 一次性激活链接（invite-link-and-reads delta ①）：这个屏现在是独立路由，路由切换
  // 本来就会卸载整个屏——"切走这个 tab 不销毁"的旧顾虑（见文件头历史注 D1）不再适用，
  // 但功能行为不能倒退：同一个屏内"关闭/覆盖"逻辑仍然维持，state 挂在这里（屏顶层）
  // 而不是更深的子组件，好处只是少一层 prop 传递，不是别的语义。
  const [oneTimeLink, setOneTimeLink] = React.useState<OneTimeLink | null>(null);
  // 共享链接的一次性明文展示（shared-invite-links delta）：同一条 D1 纪律。
  const [sharedLinkReveal, setSharedLinkReveal] = React.useState<SharedLinkReveal | null>(null);
  return (
    <OrgAdminShell active="org-invites" icon={Mail} title={t("orgMembers.invitations")}>
      {orgId ? (
        <InvitesTab
          orgId={orgId}
          isAdmin={isAdmin}
          oneTimeLink={oneTimeLink}
          onOneTimeLink={setOneTimeLink}
          sharedLinkReveal={sharedLinkReveal}
          onSharedLinkReveal={setSharedLinkReveal}
        />
      ) : (
        <LoadingSkeleton rows={3} />
      )}
    </OrgAdminShell>
  );
}

/** `/org-admin/profile` —— 组织资料，与 `/admin`（总览）平级；仅组织 admin 能读到内容。 */
export function OrgProfileScreen() {
  const { t } = useI18n();
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const isAdmin = identity?.orgRole === "admin";
  return (
    <OrgAdminShell active="org-profile" icon={Settings} title={t("adminNavigation.item.org-profile")}>
      {orgId ? <OrgProfileTab orgId={orgId} /> : <LoadingSkeleton rows={4} />}
      {/* issue #3068 —— 「以后都允许」此前无任何撤销路径，卡片文案却承诺"下次弹出改选
          拒绝以撤销"（那个弹层再也不会出现）。这里是那句文案现在指向的真实入口；
          放在组织资料屏而不是新开导航项的理由见该组件头注。 */}
      <StandingToolGrantsSection />
      {/* issue #4178 —— 记忆抽取从部署启动参数改成组织落库、admin 可来回切换；
          同样挂在组织资料屏（见该组件头注）。 */}
      <KnowledgeExtractionToggleSection isAdmin={isAdmin} />
    </OrgAdminShell>
  );
}

function LoadingSkeleton({ rows }: { rows: number }) {
  return (
    <div data-testid="loading" className="flex animate-pulse flex-col gap-2 pt-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-lg bg-muted" />
      ))}
    </div>
  );
}

/**
 * 成员/邀请/组织资料三个屏共用——按数据类型（成员/邀请/组织资料）给出不同的
 * 404/403 提示文案。
 */
function describeFailureFor(failure: unknown, notFoundHint: string, forbiddenHint: string, t: Translator = (key, params) => translate("zh-CN", key, params)): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return t("orgMembers.yourSessionHasExpiredHTTP401SignInAgain");
    if (failure.status === 403) return t("orgMembers.httpForbidden", { hint: forbiddenHint });
    if (failure.status === 404) return t("orgMembers.httpNotFound", { hint: notFoundHint });
    return t("orgMembers.httpFailure", { reason: failure.reasonCode ?? t("orgMembers.operationFailed"), status: failure.status });
  }
  return failure instanceof Error ? failure.message : t("orgMembers.couldNotLoadTryAgainLater");
}

/* ═══════════════════════════════ 成员（#363，真实数据） ═══════════════════════════════ */

/**
 * member-role-management delta（组织级）—— 「组织角色」下拉，只在 `isAdmin` 时渲染成可操作控件；
 * 非 admin 看到的仍是只读徽章（角色本身对全员可见，`listOrgMembers` 就带着它——这里不是
 * 「藏信息」，是「藏写入口」）。
 *
 * 控件复用 `PopoverSelect`（同 `ReviewerFunctionPicker`，F06 的理由：原生 `<select>` 的弹层
 * 不在页面 DOM 事件系统内，自动化驱动不了）。选项集合与邀请表单的 `ORG_ROLE_OPTIONS`
 * 同一份——四种组织角色只在契约 `identity.OrgRole` 声明一次，这里不再抄。
 *
 * 失败文案按契约 `setOrgMemberRole.err` 逐码翻译：`LAST_ADMIN` 是这块屏唯一需要用户
 * 改变动作顺序的码（先提一个新 admin），必须说清楚，不能只显示码。
 */
function describeRoleChangeFailure(failure: unknown, t: Translator): string {
  if (failure instanceof ApiError) {
    switch (failure.reasonCode) {
      case "LAST_ADMIN":
        return t("orgMembers.thisIsTheOrganizationSLastAdministratorAssignAnother");
      case "MEMBER_NOT_FOUND":
        return t("orgMembers.thisPersonIsNoLongerAMemberRefreshThe");
      case "PROJECT_ROLE_INSUFFICIENT":
      case "NO_ORG_MEMBERSHIP":
        return t("orgMembers.onlyOrganizationAdministratorsCanChangeMemberRoles");
      default:
        return t("orgMembers.httpFailure", { reason: failure.reasonCode ?? t("orgMembers.operationFailed"), status: failure.status });
    }
  }
  return failure instanceof Error ? failure.message : t("orgMembers.theOperationFailedTryAgainLater");
}

function OrgRolePicker({
  orgId, userId, current, onChanged,
}: {
  orgId: string;
  userId: string;
  current: OrgRole;
  onChanged: (userId: string, next: OrgRole, previous: OrgRole) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const handleSelect = async (id: string) => {
    const next = id as OrgRole;
    if (next === current) return;
    setBusy(true);
    setError(null);
    try {
      const out = await setOrgMemberRole(orgId, userId, next);
      onChanged(userId, out.orgRole, out.previousOrgRole);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex basis-full items-center gap-1.5 sm:basis-auto">
      <div className="w-full sm:w-32">
        <PopoverSelect
          value={current}
          options={orgRoleOptions(t)}
          onSelect={(id) => void handleSelect(id)}
          disabled={busy}
          testid={`org-admin-member-${userId}-org-role`}
          ariaLabel={t("orgMembers.organizationRole")}
        />
      </div>
      {error !== null && (
        <span role="alert" className="text-10 text-destructive" data-testid={`org-admin-member-${userId}-org-role-error`}>
          {describeRoleChangeFailure(error, t)}
        </span>
      )}
    </div>
  );
}

/** 导出供测试直接渲染，不必连 `useSession` 一起 mock 出整个 `OrgAdminScreen`。 */
export function MembersTab({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  return <MembersTabContent key={orgId} orgId={orgId} isAdmin={isAdmin} />;
}
function MembersTabContent({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const { t, locale } = useI18n();
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<unknown>(null);
  const [out, setOut] = React.useState<ListOrgMembersOut | null>(null);
  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");

  const load = React.useCallback(async () => {
    setState("loading");
    setFailureMessage(null);
    try {
      const result = await listOrgMembers(orgId);
      setOut(result);
      setState(result.members.length === 0 ? "empty" : "default");
    } catch (err) {
      setFailureMessage(err);
      setState("dep-failed");
    }

  }, [orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const [roleBanner, setRoleBanner] = React.useState<{ who: string; next: OrgRole; previous: OrgRole } | null>(null);
  React.useEffect(() => {
    if (!roleBanner) return;
    const t = setTimeout(() => setRoleBanner(null), 4000);
    return () => clearTimeout(t);
  }, [roleBanner]);

  // 改角色成功后就地更新那一行，不整表重拉——服务端回传的 `orgRole` 就是落库后的值，
  // 重拉只会让整块名单闪一次骨架屏。
  const handleOrgRoleChanged = (userId: string, next: OrgRole, previous: OrgRole) => {
    setOut((prev) =>
      prev === null ? prev : { members: prev.members.map((m) => (m.userId === userId ? { ...m, orgRole: next } : m)) },
    );
    const who = out?.members.find((m) => m.userId === userId)?.displayName ?? userId;
    setRoleBanner({ who, next, previous });
  };


  const filteredMembers = (out?.members ?? []).filter(m => (!query || `${m.displayName} ${m.email}`.toLowerCase().includes(query.toLowerCase())) && (roleFilter === "all" || m.orgRole === roleFilter) && (statusFilter === "all" || m.status === statusFilter));
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [query, roleFilter, statusFilter, orgId]);
  const pages = Math.max(1, Math.ceil(filteredMembers.length / 10));
  const currentPage = Math.min(page, pages);
  React.useEffect(() => setPage(previous => Math.min(previous, pages)), [pages]);
  return (
    <div className="flex flex-col gap-3 pt-3">
      {/*
        只有一个人的时候，多人版的说明是错的（#3872 R1 实测）。
        本地版装完就是一个人：名单上只有自己，而这段却写着「任何组织成员均可查看这份名单；
        管理员可在此直接调整每个人的组织角色」——「每个人」指的是他自己。
        写给一群人的话用在一个人身上，读起来像这个产品不知道自己被装在哪。
      */}
      <p className="text-11 text-muted-foreground" data-testid="org-admin-members-intro">
        {out !== null && out.members.length === 1
          ? t("orgMembers.youAreTheOnlyPersonInThisWorkspaceInvite")
          : t(isAdmin ? "orgMembers.membersIntroAdmin" : "orgMembers.membersIntro")}
      </p>
      {roleBanner ? (
        <div
          role="status"
          data-testid="org-admin-member-role-banner"
          className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-11 text-success"
        >
          {t("orgMembers.organizationRoleUpdated")}{t("orgMembers.roleChange", { name: roleBanner.who, previous: t(`role.${roleBanner.previous}`), next: t(`role.${roleBanner.next}`) })}
        </div>
      ) : null}
      {out && <>
        <div className="grid gap-4 sm:grid-cols-3">
          <OrganizationStatCard label={t("orgMembers.members")} value={out.members.length} />
          <OrganizationStatCard label={t("role.admin")} value={out.members.filter(m => m.orgRole === "admin").length} />
          <OrganizationStatCard label={t("orgMembers.suspended")} value={out.members.filter(m => m.status === "suspended").length} />
        </div>
        <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-4">
          <Input className="min-w-0 flex-1" aria-label={t("orgPeople.searchMembers")} placeholder={t("orgPeople.searchMembers")} value={query} onChange={e => setQuery(e.target.value)} />
          <select className="rounded-md border border-border bg-background px-3 text-13" aria-label={t("orgMembers.organizationRole")} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="all">{t("orgPeople.allRoles")}</option>{orgRoleOptions(t).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select className="rounded-md border border-border bg-background px-3 text-13" aria-label={t("orgPeople.status")} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">{t("orgPeople.allStatuses")}</option><option value="active">{t("orgPeople.active")}</option><option value="suspended">{t("orgMembers.suspended")}</option>
          </select>
        </div>
      </>}
      <StateShell
        state={state}
        emptyHint={t("orgMembers.thisOrganizationHasNoOtherMembers")}
        depFailure={{ what: failureMessage !== null ? describeFailureFor(failureMessage, t("orgMembers.organizationUnavailable"), t("orgMembers.memberListForbidden"), t) : t("orgMembers.theMemberListIsTemporarilyUnavailable"), retry: load }}
      >
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="hidden grid-cols-[minmax(200px,1fr)_160px_120px_160px] gap-4 border-b border-border bg-muted/30 px-5 py-3 text-12 text-muted-foreground sm:grid" aria-hidden="true"><span>{t("orgMembers.members")}</span><span>{t("orgMembers.organizationRole")}</span><span>{t("orgPeople.status")}</span><span>{t("orgMembers.joined")}</span></div>
        <ul className="flex flex-col divide-y divide-border" data-testid="org-admin-member-list">
          {filteredMembers.slice((currentPage - 1) * 10, currentPage * 10).map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-4 px-5 py-4 sm:grid sm:grid-cols-[minmax(200px,1fr)_160px_120px_160px]" data-testid={`org-admin-member-${m.userId}`}>
              <div className="flex min-w-0 items-center gap-3"><Avatar initials={m.displayName.slice(0, 1)} size="sm" />
              {/*
                F15 复核发现（issue #1877）：这个 flex 子项此前没有 `flex-1`，长显示名
                （如种子数据里的 "SSP E2E Org Admin Keyboard Target"）在窄视口下会把
                自己撑到内容宽度，导致整行在 `flex-wrap` 下被挤到换行——角色徽章跟着
                掉到下一行，视觉上显得七零八落。技术上没有违反任何间距/颜色规则，
                纯粹是这一项该收缩时没收缩。加 `flex-1` 后它会先吃掉其余兄弟元素
                （角色/加入日期）排完后剩下的空间，多余文字交给已有的
                `truncate` 省略号处理，不再触发整行换行。
              */}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-13 font-medium" data-testid={`org-admin-member-${m.userId}-name`}>{m.displayName}</span>
                <span className="truncate text-10 text-muted-foreground">{m.email}</span>
              </div>
              </div>
              {/* member-role-management delta：admin 看到的是可改的下拉，其他人看到只读徽章。 */}
              {isAdmin ? (
                <OrgRolePicker orgId={orgId} userId={m.userId} current={m.orgRole} onChanged={handleOrgRoleChanged} />
              ) : (
                <Badge tone={m.orgRole === "admin" ? "danger" : "neutral"} className="ml-1">
                  {t(`role.${m.orgRole}`)}
                </Badge>
              )}
              <span><Badge tone={m.status === "suspended" ? "outline" : "neutral"}>{m.status === "suspended" ? t("orgMembers.suspended") : t("orgPeople.active")}</Badge></span>
              {/* F15 复核：同上，加入日期在窄屏也让位——basis-full 独占一行，
                  sm 起再回到行尾 ml-auto 贴右对齐。 */}
              <span
                className="basis-full text-right text-10 text-muted-foreground sm:ml-auto sm:basis-auto"
                data-testid={`org-admin-member-${m.userId}-joined`}
              >
                {new Date(m.joinedAt).toLocaleDateString(locale)} {t("orgMembers.joined")}</span>
            </li>
          ))}
          {filteredMembers.length === 0 && <li className="p-8 text-center text-13 text-muted-foreground">{t("orgPeople.noMatches")}</li>}
        </ul>
        </div>
        <PeoplePagination page={currentPage} pages={pages} onChange={setPage} />
      </StateShell>
    </div>
  );
}

/* ═══════════════════════════════ 邀请（#363，仅 admin） ═══════════════════════════════ */

/** 与 `admin/member-invites-panel.tsx`（`/admin` 成员与配额屏的待处理邀请摘要）共用——
 *  邀请状态的文案单源，别在第二处再抄一份。 */
const INVITE_STATUS_KEYS = { pending: "orgMembers.pendingAcceptance", "awaiting-review": "invitation.needsResend", revoked: "orgMembers.revoked", used: "orgMembers.used", "send-failed": "orgMembers.sendFailed" } as const;
export const INVITE_STATUS_LABEL: Record<string, string> = Object.fromEntries(Object.entries(INVITE_STATUS_KEYS).map(([status, key]) => [status, translate("zh-CN", key)]));
export function inviteStatusLabel(status: string, t: Translator) {
  const key = Object.prototype.hasOwnProperty.call(INVITE_STATUS_KEYS, status) ? INVITE_STATUS_KEYS[status as keyof typeof INVITE_STATUS_KEYS] : undefined;
  return key ? t(key) : status;
}

/**
 * 邀请相关写操作的错误码 → 人话。撑开 `describeFailureFor` 覆盖不到的邀请专属语义
 * （错误码全部来自契约 `inviteOrgMember`/`resendOrgInvite`/`revokeOrgInvite`/
 * `reviewAdminInvite` 的 `err` 声明，不是这里发明的）。
 */
function describeInviteFailure(failure: unknown, t: Translator, locale: Locale = "zh-CN"): string {
  if (failure instanceof ApiError) {
    switch (failure.reasonCode) {
      case "INVITE_ALREADY_MEMBER":
        return t("orgMembers.thisEmailAlreadyBelongsToAnOrganizationMemberNo");
      case "INVITE_DUPLICATE":
        return t("orgMembers.thisEmailHasAnUnfinishedInvitationWithADifferent");
      case "QUOTA_EXHAUSTED":
        return t("orgMembers.theOrganizationHasNoMemberCapacityLeftNoInvitation");
      case "MAIL_UNAVAILABLE":
        return t("orgMembers.emailIsUnavailableTheInvitationIsRecordedAsSend");
      case "RATE_LIMITED":
        return t("orgMembers.resendLimit", { seconds: authContract.AUTH_POLICY.resendCooldownSeconds, count: authContract.AUTH_POLICY.resendDailyMax });
      case "INVITE_SELF_REVIEW_FORBIDDEN":
        return t("orgMembers.youCannotReviewYourOwnInvitationAnotherAdministratorMust");
      case "VERSION_CHANGED":
        return t("orgMembers.theInvitationChangedWasUsedOrWasRevokedThe");
      case "INVITE_NOT_FOUND":
        return t("orgMembers.theInvitationDoesNotExistOrIsUnavailableTo");
      case "PROJECT_ROLE_INSUFFICIENT":
        return t("orgMembers.onlyOrganizationAdministratorsCanPerformThisActionHTTP403");
      case "NO_ORG_MEMBERSHIP":
        return t("orgMembers.youAreNotAMemberOfThisOrganizationHTTP");
    }
    if (failure.status === 401) return t("orgMembers.yourSessionHasExpiredHTTP401SignInAgain");
    if (failure.status === 403) return t("orgMembers.youCannotPerformThisActionHTTP403");
    return describeFailure(failure, locale);
  }
  return describeFailure(failure, locale);
}

/**
 * 弹层单选——同 `top-bar.tsx` 的 `OrgSwitcher` 模式（#860 把裸原生 select 换掉的
 * 同一处置）：Button 触发 + role=listbox 弹层，外点/Escape 关闭。
 */
// export 供 shared-invite-links.tsx 复用——同一份弹层单选实现不许出现第二份副本。
export function PopoverSelect({
  value, options, onSelect, disabled, testid, ariaLabel,
}: {
  value: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  onSelect: (id: string) => void;
  disabled?: boolean;
  testid: string;
  ariaLabel: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const currentLabel = options.find((o) => o.id === value)?.label ?? value;

  // F06（issue #1930）—— 关闭弹层时把焦点带回触发按钮（Esc / 选中选项两条路径），
  // 不让它落到 <body>：选中的选项按钮随弹层一起卸载，浏览器默认行为会把焦点丢到
  // <body>，这正是 R6「关键节点 focus 环可见」要防的坑——键盘用户选完一项之后
  // 应该能立刻继续 Tab/操作，而不是先要重新找回焦点在哪。外点关闭不在此列：
  // 那种情况下用户的焦点意图本来就是点到的那个别的元素，不应该被强行拽回来。
  const closeAndRefocus = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndRefocus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeAndRefocus]);

  return (
    <div ref={containerRef} className="relative">
      {/*
        * ⚠ 不用原生 `disabled`——原生 disabled 的按钮在被禁用的瞬间会被浏览器强制
        * blur（disabled 元素不能持有焦点），如果这一刻正好是这个按钮自己持有焦点
        * （典型场景：刚选完一个选项、`assignSkillReviewerFunction` 请求还在飞行中、
        * `busy=true`），焦点会被弹到 <body>——同上面 `closeAndRefocus` 想防的是
        * 同一类问题，只是触发路径不同（那个防的是"选项按钮卸载"，这个防的是"触发
        * 按钮被禁用"）。改用 `aria-disabled` + 手动拦截 `onClick`，按钮始终可持有
        * 焦点，语义仍然是"当前不可操作"。
        */}
      <Button
        ref={triggerRef}
        type="button"
        size="xs"
        variant="outline"
        data-testid={testid}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        aria-label={t("orgMembers.currentSelection", { label: ariaLabel, value: currentLabel })}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        className={cn(
          "h-8 w-full justify-between gap-1 rounded-md pl-2.5 pr-2 text-12 font-normal",
          disabled && "cursor-not-allowed bg-disabled text-disabled-foreground",
        )}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
      </Button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          data-testid={`${testid}-listbox`}
          className="absolute left-0 top-9 z-20 max-h-56 w-full min-w-40 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              data-testid={`${testid}-option-${o.id}`}
              onClick={() => {
                onSelect(o.id);
                closeAndRefocus();
              }}
              className={[
                "flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 hover:bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                o.id === value ? "text-primary" : "text-popover-foreground",
              ].join(" ")}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 一次性激活链接的展示载荷（invite-link-and-reads delta ①）。导出给
 *  `admin/member-invites-panel.tsx` 复用重发流程——不重新拼一份链接展示逻辑。 */
export type OneTimeLink = {
  readonly email: string;
  readonly url: string;
  /** invited = 新签发；resent = 重发（旧链接已作废）；approved = 双人复核批准后签发（D2 裁决 A）。 */
  readonly kind: "invited" | "resent" | "approved";
};

/**
 * 一次性激活链接展示块（coord-main 2026-08-11 裁决 A）。
 *
 * 四态：展示中（默认）/ 已复制反馈 / 复制失败降级（提示手动全选）/ 关闭后消失。
 * ⚠ 链接**只在这一次响应里存在**——刷新列表、重新进页都拿不回来（服务端列表恒不含
 *   token），所以文案必须把「只显示这一次」说死，关闭要二次意图（按钮文案本身承担）。
 */
export function OneTimeActivationLink({ link, onDismiss }: { link: OneTimeLink; onDismiss: () => void }) {
  const { t } = useI18n();
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopyState("copied");
      window.setTimeout(() => setCopyState((s) => (s === "copied" ? "idle" : s)), 2500);
    } catch {
      // 剪贴板权限被拒/非安全上下文：降级为选中文本，让用户手动 Cmd/Ctrl+C。
      setCopyState("failed");
      inputRef.current?.select();
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
      data-testid="org-admin-invite-link-block"
      role="region"
      aria-label={t("orgMembers.oneTimeActivationLink")}
    >
      <p className="text-12 font-medium">
        {link.kind === "resent"
          ? t("orgMembers.resentLink", { email: link.email })
          : link.kind === "approved"
            ? t("orgMembers.approvedLink", { email: link.email })
            : t("orgMembers.inviteeLink", { email: link.email })}
      </p>
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          readOnly
          value={link.url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 flex-1 font-mono text-11"
          aria-label={t("orgMembers.activationLinkShownOnlyOnce")}
          data-testid="org-admin-invite-link-url"
        />
        <Button type="button" size="xs" variant="primary" onClick={() => void copy()} data-testid="org-admin-invite-link-copy">
          <Copy aria-hidden className="h-3 w-3" />
          {copyState === "copied" ? t("orgMembers.copied") : t("orgMembers.copy")}
        </Button>
      </div>
      {copyState === "copied" && (
        <p role="status" className="text-10 text-success" data-testid="org-admin-invite-link-copied">
          {t("orgMembers.copiedToTheClipboardSendItToTheInvitee")}</p>
      )}
      {copyState === "failed" && (
        <p role="alert" className="text-10 text-destructive" data-testid="org-admin-invite-link-copy-failed">
          {t("orgMembers.automaticCopyingWasBlockedTheLinkIsSelectedPress")}</p>
      )}
      <p className="text-10 text-warning" data-testid="org-admin-invite-link-once-note">
        {t("orgMembers.thisLinkIsShownOnlyOnceCopyItAnd")}{link.kind === "resent" ? t("orgMembers.thePreviousLinkHasAlsoBeenRevoked") : ""}
        {t("orgMembers.closingRefreshingOrLeavingThisPagePermanentlyHidesThe")}</p>
      <div>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss} data-testid="org-admin-invite-link-dismiss">
          {t("orgMembers.iHaveSentItClose")}</Button>
      </div>
    </div>
  );
}

/**
 * issue #2615（裁决②：组织里没有团队概念）后，`inviteOrgMember` 契约的 `teamId` 字段
 * 仍然存在（后端 `org_memberships.team_id` 列没有被移除，这是人类的硬约束——本轮只去掉
 * 前端"选团队"这个动作，不改契约/schema），前端恒传空串（controller 把空串转 null，
 * 即"不分团队"）——不再让用户选，因为已经没有团队列表可选了。
 */
const NO_TEAM = "";

const orgRoleOptions = (t: Translator): ReadonlyArray<{ id: OrgRole; label: string }> => (
  AssignableOrgRole.options
).map((r) => ({ id: r, label: t(`role.${r}`) }));

// export 仅供 `tests/ui/org-admin-invite-form-novalidate.test.tsx` 机械钉 noValidate（两次复发的 bug），别在别处 import。
export function InviteMemberForm({
  orgId, onSucceeded, onFailed, onNotice,
}: {
  orgId: string;
  onSucceeded: (text: string) => void;
  onFailed: (text: string) => void;
  /** Internal screen feedback remains translatable; legacy string callbacks stay compatible. */
  onNotice?: (notice: LocalizedNotice) => void;
  /** 签发成功且响应带一次性 token 时回调（invite-link-and-reads delta ①）。 */
  onLink: (link: OneTimeLink) => void;
}) {
  const { t, locale } = useI18n();
  const [email, setEmail] = React.useState("");
  const orgRole = "consultant" as const;
  const [submitting, setSubmitting] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<Feedback | null>(null);

  function report(tone: "success" | "error", text: Feedback) {
    if (onNotice) onNotice({ tone, text });
    else if (tone === "success") onSucceeded(text(t, locale));
    else onFailed(text(t, locale));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setFieldError(() => (t: Translator) => t("orgMembers.emailIsRequired"));
      return;
    }
    if (!trimmed.includes("@")) {
      setFieldError(() => (t: Translator) => t("orgMembers.invalidEmail", { email: trimmed }));
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const out = await inviteOrgMember({ orgId, email: trimmed, orgRole, teamId: NO_TEAM });
      setEmail("");
      if (out.status === "send-failed") {
        report("error", (t) => t("orgMembers.emailIsUnavailableTheInvitationIsRecordedAsSend"));
      } else if (out.tokenIssued === false || out.quotaReserved === 0) {
        report("success", (t) => t("orgMembers.anIdenticalInvitationAlreadyExistsNoInvitationWasCreated"));
      } else {
        report("success", (t) => t("orgMembers.invitationCreatedTheActivationLinkIsValidFor7"));
      }
    } catch (err) {
      // delta ③：契约层的邮箱 400（`ZodBodyPipe` validation_failed，path = email）
      // 映射成能看懂的字段级文案，不掉进「操作失败（HTTP 400）」的兜底。
      if (contractFieldIssues(err)?.some((i) => i.path === "email")) {
        setFieldError(() => (t: Translator) => t("orgMembers.invalidEmailServer", { email: trimmed }));
      } else if (err instanceof ApiError && (err.reasonCode === "INVITE_ALREADY_MEMBER" || err.reasonCode === "INVITE_DUPLICATE")) {
        setFieldError(() => (t: Translator, locale?: Locale) => describeInviteFailure(err, t, locale));
      } else {
        report("error", (t, locale) => describeInviteFailure(err, t, locale));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3"
      onSubmit={handleSubmit}
      // noValidate：关掉浏览器原生 constraint validation（英文气泡），让本组件的中文预检
      // 与服务端 `err-invite-email` 结构化文案真正执行、真正可见。
      // ⚠ 这是 PR #896 修过又在重构中丢失而复发的 bug（独立复核第 4 条判 0）——
      //   有 `apps/web/tests/ui/org-admin-invite-form-novalidate.test.tsx` 机械钉住，别再删。
      noValidate
      data-testid="org-admin-invite-form"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-52 flex-1 flex-col gap-1">
          <Label htmlFor="org-admin-invite-email">{t("orgMembers.inviteeEmail")}</Label>
          <Input
            id="org-admin-invite-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.currentTarget.value);
              if (fieldError) setFieldError(null);
            }}
            placeholder="name@example.com"
            disabled={submitting}
            data-testid="org-admin-invite-email"
            aria-invalid={fieldError !== null}
          />
          {fieldError ? (
            <p role="alert" data-testid="err-invite-email" className="text-10 text-destructive">{fieldError(t, locale)}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-10 text-muted-foreground">
          {t("invitation.ordinaryMemberNote")}</p>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={submitting || email.trim().length === 0}
          data-testid="org-admin-invite-submit"
        >
          <Send aria-hidden className="h-3.5 w-3.5" />
          {submitting ? t("orgMembers.inviting") : t("orgMembers.sendInvitation")}
        </Button>
      </div>
    </form>
  );
}

function InviteRow({
  orgId, invite, onChanged, onSucceeded, onFailed,
}: {
  orgId: string;
  invite: ListOrgInvitesOut["invites"][number];
  /** 当前登录用户 id——判「这条邀请是不是我发起的」（delta ②）。 */
  currentUserId: string | null;
  onChanged: () => void;
  onSucceeded: (text: Feedback) => void;
  onFailed: (text: Feedback) => void;
  onLink: (link: OneTimeLink) => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = React.useState(false);

  const canResend = ["pending", "send-failed", "awaiting-review"].includes(invite.status);
  const canRevoke = canResend;

  async function run(action: () => Promise<Feedback>) {
    setBusy(true);
    try {
      const text = await action();
      onSucceeded(text);
      onChanged();
    } catch (err) {
      onFailed((t, locale) => describeInviteFailure(err, t, locale));
      if (err instanceof ApiError && (err.reasonCode === "VERSION_CHANGED" || err.reasonCode === "MAIL_UNAVAILABLE")) onChanged();
    } finally {
      setBusy(false);
      setConfirmingRevoke(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4" data-testid={`org-admin-invite-${invite.inviteId}`}>
      <div className="grid items-center gap-4 xl:grid-cols-[minmax(160px,1fr)_140px_minmax(100px,1fr)_140px_170px]">
        <span className="truncate text-13 font-medium">{invite.email}</span>
        <Badge tone={invite.status === "pending" ? "warning" : invite.status === "used" ? "primary" : invite.status === "revoked" ? "outline" : "danger"}>
          {inviteStatusLabel(invite.status, t)}
        </Badge>
        <span className="text-10 text-muted-foreground">{t("orgMembers.invitedBy", { name: invite.invitedBy })}</span>
        <span className="ml-auto text-10 text-muted-foreground" data-testid={`org-admin-invite-${invite.inviteId}-expires`}>
          {new Date(invite.expiresAt).toLocaleDateString(locale)} {t("orgMembers.expires")}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {canResend && (
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() =>
                run(async () => {
                  const out = await resendOrgInvite(orgId, invite.inviteId);
                  return (t) => t("orgMembers.invitationResent", { email: invite.email, seconds: out.cooldownSec });
                })
              }
              data-testid={`org-admin-invite-${invite.inviteId}-resend`}
            >
              <RotateCcw aria-hidden className="h-3 w-3" />
              {t("orgMembers.resend")}</Button>
          )}
          {canRevoke && !confirmingRevoke && (
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              className="text-destructive"
              onClick={() => setConfirmingRevoke(true)}
              data-testid={`org-admin-invite-${invite.inviteId}-revoke`}
            >
              <Ban aria-hidden className="h-3 w-3" />
              {t("orgMembers.revoke")}</Button>
          )}
        </div>
      </div>

      {confirmingRevoke && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5"
          data-testid={`org-admin-invite-${invite.inviteId}-revoke-confirm`}
        >
          <div className="flex items-center gap-1.5 text-11 text-destructive">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span>{t("orgMembers.revokeTheInvitationTo")}{invite.email} {t("orgMembers.itsActivationLinkWillStopWorkingImmediatelyTheInvitee")}</span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button" size="xs" variant="destructive" disabled={busy}
              onClick={() =>
                run(async () => {
                  await revokeOrgInvite(orgId, invite.inviteId);
                  return (t) => t("orgMembers.invitationRevoked", { email: invite.email });
                })
              }
              data-testid={`org-admin-invite-${invite.inviteId}-revoke-confirm-yes`}
            >
              {busy ? t("orgMembers.revoking") : t("orgMembers.confirmRevocation")}
            </Button>
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() => setConfirmingRevoke(false)}
              data-testid={`org-admin-invite-${invite.inviteId}-revoke-confirm-no`}
            >
              {t("orgMembers.cancel")}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function InvitesTab(props: React.ComponentProps<typeof InvitesTabContent>) {
  return <InvitesTabContent key={props.orgId} {...props} />;
}
function InvitesTabContent({
  orgId, isAdmin, oneTimeLink, onOneTimeLink, sharedLinkReveal, onSharedLinkReveal,
}: {
  orgId: string;
  isAdmin: boolean;
  /** 共享链接一次性明文（shared-invite-links delta），同 oneTimeLink 的挂载层纪律。 */
  sharedLinkReveal: SharedLinkReveal | null;
  onSharedLinkReveal: (reveal: SharedLinkReveal | null) => void;
  /**
   * 一次性激活链接（delta ①）：state 由 `OrgAdminScreen` 持有（见其注释：切标签页不销毁，
   * 复核 D1）。只存在于内存里；换一条会覆盖上一条——上一条已经展示过它唯一的一次机会，
   * 而同屏堆多条会诱导「回来再抄」的错误预期。
   */
  oneTimeLink: OneTimeLink | null;
  onOneTimeLink: (link: OneTimeLink | null) => void;
}) {
  const { t, locale } = useI18n();
  const { session } = useSession();
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<unknown>(null);
  const [out, setOut] = React.useState<ListOrgInvitesOut | null>(null);
  const [banner, setBanner] = React.useState<LocalizedNotice | null>(null);

  const load = React.useCallback(async () => {
    setState("loading");
    setFailureMessage(null);
    try {
      const result = await listOrgInvites(orgId);
      setOut(result);
      setState(result.invites.length === 0 ? "empty" : "default");
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

  const [inviteQuery, setInviteQuery] = React.useState("");
  const [inviteStatus, setInviteStatus] = React.useState("all");
  const filteredInvites = (out?.invites ?? []).filter(inv => inv.email.toLowerCase().includes(inviteQuery.toLowerCase()) && (inviteStatus === "all" || inv.status === inviteStatus));
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [inviteQuery, inviteStatus, orgId]);
  const pages = Math.max(1, Math.ceil(filteredInvites.length / 10));
  const currentPage = Math.min(page, pages);
  React.useEffect(() => setPage(previous => Math.min(previous, pages)), [pages]);
  return (
    <div className="flex flex-col gap-3 pt-3">
      {out && <div className="grid gap-4 sm:grid-cols-3">
        <OrganizationStatCard label={t("orgMembers.invitations")} value={out.invites.length} />
        <OrganizationStatCard label={t("orgMembers.pendingAcceptance")} value={out.invites.filter(i => i.status === "pending").length} />
        <OrganizationStatCard label={t("orgMembers.used")} value={out.invites.filter(i => i.status === "used").length} />
      </div>}
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-4">
        <Input className="min-w-0 flex-1" aria-label={t("orgPeople.searchMembers")} placeholder={t("orgPeople.searchMembers")} value={inviteQuery} onChange={e => setInviteQuery(e.target.value)} />
        <select className="rounded-md border border-border bg-background px-3 text-13" aria-label={t("orgPeople.status")} value={inviteStatus} onChange={e => setInviteStatus(e.target.value)}>
          <option value="all">{t("orgPeople.allStatuses")}</option>{Object.entries(INVITE_STATUS_KEYS).map(([status, key]) => <option key={status} value={status}>{t(key)}</option>)}
        </select>
      </div>
      <p className="text-11 text-muted-foreground">
        {t("orgMembers.sentInvitationsAndTheirStatusOnlyOrganizationAdministratorsCan")}</p>

      {/* 表单跟随标签页同一权限判定：非 admin 会在下方 StateShell 看到真实 403 的无权限态，
          这里就不再渲染一个必然失败的表单（发起邀请后端仅 admin 可做）。 */}
      {isAdmin && (
        <InviteMemberForm
          orgId={orgId}
          onSucceeded={(text) => {
            setBanner({ tone: "success", text: () => text });
            void load();
          }}
          onFailed={(text) => setBanner({ tone: "error", text: () => text })}
          onNotice={(notice) => { setBanner(notice); void load(); }}
          onLink={onOneTimeLink}
        />
      )}

      {oneTimeLink && <OneTimeActivationLink link={oneTimeLink} onDismiss={() => onOneTimeLink(null)} />}

      {banner ? (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          data-testid="org-admin-invite-banner"
          className={
            banner.tone === "success"
              ? "rounded-md border border-success/30 bg-success/10 px-3 py-2 text-11 text-success"
              : "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-11 text-destructive"
          }
        >
          {banner.text(t, locale)}
        </div>
      ) : null}

      <StateShell
        state={state}
        emptyHint={t("orgMembers.noInvitationsHaveBeenSentYet")}
        depFailure={{ what: failureMessage !== null ? describeFailureFor(failureMessage, t("orgMembers.organizationUnavailable"), t("orgMembers.inviteListForbidden"), t) : t("orgMembers.theInvitationListIsTemporarilyUnavailable"), retry: load }}
        denial={{ layer: "organization", reason: t("orgMembers.onlyOrganizationAdministratorsCanViewInvitationsYouAreNot") }}
      >
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card" data-testid="org-admin-invite-list">
          {filteredInvites.slice((currentPage - 1) * 10, currentPage * 10).map((inv) => (
            <InviteRow
              key={inv.inviteId}
              orgId={orgId}
              invite={inv}
              currentUserId={session?.userId ?? null}
              onLink={onOneTimeLink}
              onChanged={() => void load()}
              onSucceeded={(text) => setBanner({ tone: "success", text })}
              onFailed={(text) => setBanner({ tone: "error", text })}
            />
          ))}
          {filteredInvites.length === 0 && <li className="p-8 text-center text-13 text-muted-foreground">{t("orgPeople.noMatches")}</li>}
        </ul>
        <PeoplePagination page={currentPage} pages={pages} onChange={setPage} />
      </StateShell>
      {isAdmin && (
        <SharedInviteLinksSection
          orgId={orgId}
          currentUserId={session?.userId ?? null}
          reveal={sharedLinkReveal}
          onReveal={onSharedLinkReveal}
        />
      )}
      {!isAdmin && state !== "denied" && (
        <p className="text-10 text-muted-foreground">{t("orgMembers.youAreNotAnOrganizationAdministratorIfContentAppears")}</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════ 组织资料（#363，仅 admin） ═══════════════════════════════ */

const DESCRIPTION_MAX = 500;

/*
 * 组织头像的受鉴权拉取（原 useAuthedImageSrc）已提升到 `lib/use-authed-image-src.ts`
 * 共享——左上角组织菜单（`components/shell/org-menu.tsx`）也要拉同一类受鉴权图片，
 * 同一份实现不许出现第二份副本。理由与 D9 实测见该文件头注释。
 */

function OrgProfileTab({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const { updateOrgName } = useSession();
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<Feedback | null>(null);
  const [profile, setProfile] = React.useState<UpdateOrganizationOut | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [invalidFields, setInvalidFields] = React.useState<Record<string, Feedback>>({});
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const [avatarError, setAvatarError] = React.useState<Feedback | null>(null);
  const [avatarSavedNotice, setAvatarSavedNotice] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setState("loading");
    setFailureMessage(null);
    try {
      // 无独立读端点，见本文件顶部注释：不带任何字段的 updateOrganization 是纯读。
      //
      // invite-link-and-reads delta ④ 之后，`resolveIdentity` 的 `org.avatarUrl` 已让
      // 全员读得到组织头像——但这条空补丁读**不退役**：本标签页是 admin 编辑器，还要
      // name/description（identity 那条只带头像），且它作为「刚上传完头像后的权威回读」
      // 不经过 session 缓存，恰好是缓存失效后的刷新路径。两条读路径服务两种角色，
      // 不是同一事实的第二份声明（URL 拼装的单一事实源在后端 avatarUrlFor）。
      const result = await updateOrganization({ orgId });
      setProfile(result);
      setName(result.name);
      setDescription(result.description ?? "");
      setState("default");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setState("denied");
        return;
      }
      setFailureMessage(() => (currentT: Translator) => describeFailureFor(err, currentT("orgProfile.notFound"), currentT("orgProfile.forbidden"), currentT));
      setState("dep-failed");
    }
  }, [orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const dirty = profile !== null && (name.trim() !== profile.name || description !== (profile.description ?? ""));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    // D4：只收当次真正违反的字段——不是无条件把两条校验文案都传给 StateShell，
    // 否则简介明明合规也会跟着弹出「简介不能超过 500 字」（实测：44/500 字也弹）。
    const violations: Record<string, Feedback> = {};
    if (trimmed.length === 0) violations.name = (currentT) => currentT("orgProfile.nameRequired");
    if (description.length > DESCRIPTION_MAX) violations.description = (currentT) => currentT("orgProfile.descriptionLimit", { max: DESCRIPTION_MAX });
    if (Object.keys(violations).length > 0) {
      setInvalidFields(violations);
      setState("invalid");
      return;
    }
    setState("loading");
    setFailureMessage(null);
    try {
      const out = await updateOrganization({ orgId, name: trimmed, description });
      setProfile(out);
      setName(out.name);
      setDescription(out.description ?? "");
      setState("success");
      // #728 D 类：改名成功后顶栏切换器要跟着刷新，不是等下一次整页 reload 才同步
      // （同一份 session-provider 机制：`updateDisplayName` 改自己姓名时的先例）。
      updateOrgName(orgId, out.name);
    } catch (err) {
      setFailureMessage(() => (currentT: Translator) => describeFailureFor(err, currentT("orgProfile.notFound"), currentT("orgProfile.forbidden"), currentT));
      setState("dep-failed");
    }
  }

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setAvatarError(null);
    setAvatarSavedNotice(false);
    setAvatarUploading(true);
    try {
      const uploaded = await uploadOrgAvatar({ orgId, file });
      const out = await updateOrganization({ orgId, avatarArtifactId: uploaded.orgAvatarArtifactId });
      setProfile(out);
      // 左上角组织菜单也显示这张头像（2026-08-11 信息架构调整）——同下面 updateOrgName
      // 的道理：同一个事实两处显示，不许等整页 reload 才同步。
      invalidateOrgAvatar(orgId);
      // D5：图片本身要靠鉴权 fetch 异步拉回来才显示（见 `useAuthedImageSrc`），中间那段
      // 时间用户不该完全没反馈——补一条显式的成功提示，2.5s 后自动收起。
      setAvatarSavedNotice(true);
      window.setTimeout(() => setAvatarSavedNotice(false), 2500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.reasonCode === "FILE_TOO_LARGE") setAvatarError(() => (currentT: Translator) => currentT("orgProfile.avatarTooLarge"));
        else if (err.reasonCode === "UNSUPPORTED_CONTENT_TYPE") setAvatarError(() => (currentT: Translator) => currentT("orgProfile.avatarType"));
        else setAvatarError(() => (currentT: Translator) => currentT("orgProfile.avatarApiFailed", { reason: err.reasonCode ?? err.status }));
      } else if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        // 2026-08-11 devapp 实测：请求可能永远不返回（见 live-org-admin.ts 的硬超时）。
        // 超时必须给出明确反馈，不许停在「上传中…」。
        setAvatarError(() => (currentT: Translator) => currentT("orgProfile.avatarTimeout"));
      } else {
        setAvatarError(() => (currentT: Translator) => currentT("orgProfile.avatarFailed"));
      }
    } finally {
      setAvatarUploading(false);
    }
  }

  // ⚠ 2026-08-11 实测修复：原来写 `${apiBaseUrl()}${profile.avatarUrl}` 字符串拼接，
  //   会吃掉 `NEXT_PUBLIC_API_PATH_PREFIX`（fullstack e2e 的同源代理前缀）——
  //   avatar-file GET 打到没有前缀的路径上 404，头像在代理环境下永远显示回落态。
  //   `apiUrl()` 是本仓唯一的 URL 拼接规则（api-client.ts #654 注释），跟着它走。
  const avatarUrl = profile?.avatarUrl ? apiUrl(profile.avatarUrl) : null;
  const { src: avatarSrc } = useAuthedImageSrc(avatarUrl);

  return (
    <div className="flex flex-col gap-6 pt-3">
      <StateShell
        state={state}
        skeletonRows={4}
        errors={Object.fromEntries(Object.entries(invalidFields).map(([field, message]) => [field, message(t)]))}
        depFailure={{ what: failureMessage ? failureMessage(t) : t("orgProfile.unavailable"), retry: load }}
        denial={{ layer: "organization", reason: t("orgProfile.denied") }}
        successMessage={t("state.saved")}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-6" data-testid="org-admin-avatar-block">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 组织头像来自后端 object store，非 Next 静态资源
              <img
                src={avatarSrc}
                alt={t("orgProfile.avatarAlt", { name: profile?.name ?? t("ui.organization") })}
                className="h-9 w-9 rounded-full object-cover"
                data-testid="org-admin-avatar-image"
              />
            ) : (
              <Avatar initials={(profile?.name ?? t("ui.organization")).slice(0, 1)} size="lg" />
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="truncate text-24 font-semibold">{profile?.name}</h2>
              {profile?.description && <p className="text-13 text-muted-foreground">{profile.description}</p>}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={handleAvatarPick}
                data-testid="org-admin-avatar-file-input"
              />
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={avatarUploading}
                onClick={() => fileInputRef.current?.click()}
                data-testid="org-admin-avatar-upload"
              >
                <Camera aria-hidden className="h-3 w-3" />
                {avatarUploading ? t("orgProfile.avatarUploading") : t("orgProfile.changeAvatar")}
              </Button>
              <p className="text-10 text-muted-foreground">{t("orgProfile.avatarHelp")}</p>
              {avatarSavedNotice && (
                <p role="status" data-testid="org-admin-avatar-saved" className="text-10 text-success">
                  {t("orgProfile.avatarSaved")}
                </p>
              )}
              {avatarError && (
                <p role="alert" data-testid="org-admin-avatar-error" className="text-10 text-destructive">
                  {avatarError(t)}
                </p>
              )}
            </div>
          </div>

          <form className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6" onSubmit={handleSave} data-testid="org-admin-profile-form">
            <h2 className="border-b border-border pb-4 text-16 font-semibold">{t("orgPeople.basicSettings")}</h2>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-admin-name">{t("orgProfile.name")}</Label>
              <Input
                id="org-admin-name"
                value={name}
                disabled={state === "loading"}
                onChange={(e) => {
                  setName(e.currentTarget.value);
                  if (state !== "default") setState("default");
                }}
                data-testid="org-admin-name-input"
                aria-invalid={state === "invalid" && name.trim().length === 0}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-admin-description">{t("orgProfile.description")}</Label>
              <Textarea
                id="org-admin-description"
                value={description}
                disabled={state === "loading"}
                maxLength={DESCRIPTION_MAX}
                onChange={(e) => {
                  setDescription(e.currentTarget.value);
                  if (state !== "default") setState("default");
                }}
                data-testid="org-admin-description-input"
                aria-invalid={state === "invalid" && description.length > DESCRIPTION_MAX}
              />
              <p className="text-10 text-muted-foreground">
                {t("orgProfile.descriptionHelp", { count: description.length, max: DESCRIPTION_MAX })}
              </p>
            </div>

            <div className="flex justify-end border-t border-border pt-5">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={state === "loading" || !dirty}
                data-testid="org-admin-profile-save"
              >
                {state === "loading" ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </form>
        </div>
      </StateShell>
    </div>
  );
}

function PeoplePagination({page, pages, onChange}: {page: number; pages: number; onChange: (page: number) => void}) {
  const {t} = useI18n();
  return <nav aria-label={t("orgPeople.pagination")} className="flex items-center justify-end gap-3 py-3 text-13"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>{t("orgPeople.previous")}</Button><span>{page} / {pages}</span><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>{t("orgPeople.next")}</Button></nav>;
}
