"use client";

import * as React from "react";
import { AlertTriangle, Ban, Camera, Check, ChevronDown, Copy, Hourglass, Mail, Pencil, Plus, RotateCcw, Send, Settings, Trash2, UserCog, Users, X } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError, apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { invalidateOrgAvatar } from "@/components/shell/org-menu";
import { contractFieldIssues } from "@/lib/auth";
import { buildActivationLink } from "@/lib/activation-link";
import { ORG_ROLE_LABEL, type OrgRole } from "@/lib/identity";
import { auth as authContract } from "@repo/contracts";
import { SharedInviteLinksSection, type SharedLinkReveal } from "@/components/org-admin/shared-invite-links";
import {
  createTeam, deleteTeam, listTeams, renameTeam, listOrgMembers, listOrgInvites,
  updateOrganization, uploadOrgAvatar,
  inviteOrgMember, resendOrgInvite, revokeOrgInvite, reviewAdminInvite,
  assignSkillReviewerFunction, revokeSkillReviewerFunction, listSkillReviewerFunctions,
  type ListTeamsOut, type ListOrgMembersOut, type ListOrgInvitesOut, type UpdateOrganizationOut,
  type SkillReviewerFunctionValue,
} from "@/lib/live-org-admin";

/**
 * `/org-admin` —— 组织管理页（#639 delta 迭代 1 起步 → 迭代 2 团队增删改 → #363 收拢补齐）。
 *
 * ## 团队标签页（#639 delta 迭代 2）
 * 创建 / 改名 / 删除已接线，见 `TeamsTab`/`CreateTeamForm`/`TeamRow`。成员加入/移出
 * （`org_memberships.team_id` 写路径）仍不在本轮——列表里每个团队只显示人数，没有
 * "添加成员"入口，避免暗示这个功能存在。
 *
 * ## 本轮范围（#363 收拢：成员/邀请列表读 + 组织资料编辑）
 * - "成员"标签页：真实 `listOrgMembers`——任何组织成员可读（delta §2）。
 * - "邀请"标签页：真实 `listOrgInvites`——**仅组织 admin**，权限比"成员"更紧，
 *   非 admin 会看到真实 403 映射出的「无权限」态，不是隐藏标签页——隐藏会让人以为
 *   这个功能不存在，而「存在但你看不到」和「不存在」是两件事（UC-0.3 R8）。
 * - "组织资料"标签页：仅组织 admin 可见（编辑动作本身就是 admin-only，非 admin 看到
 *   这个标签页也读不到内容，索性不渲染标签，避免"点进去才发现自己不能干嘛"）。
 *
 * ⚠ 组织资料**没有独立的读端点**（contract.md 这份 delta 只定义了 `updateOrganization`
 *   一个写操作，`out` 回显新状态，但没有 `getOrganization`）——首次进入"组织资料"标签页
 *   时用**不带任何字段的 `updateOrganization({orgId})`调用**当读：本仓后端实现里
 *   `sets.length === 0` 分支是纯 `SELECT`，不写库（`pg-org-profile-repository.ts`）。
 *   这不是新契约操作，是复用同一个已签核操作的"空补丁即读"形状——同 `mutateTeam`
 *   没有独立 read 操作、复用同一契约面的既有处置。
 *
 * ⚠ 成员/邀请两个标签页此前只有 mock 版本，挂在 `/org-admin/preview?screen=members`/
 *   `?screen=invites`（`org-admin-app.tsx` 的原型切换器，由 admin-nav.tsx 的"成员"
 *   二级导航项进入）。**没有摘除那条导航入口**——它是 ADR-023 的签核材料现行路由
 *   （`.harness/scripts/nav-reachability.config.json` 的 `org-admin` 束），删掉会打红
 *   `lint-nav-reachability.mjs`，且人类在 #700 已经裁决"不删这组入口，只标'原型·待归并'"。
 *   `components/org-admin/members-screen.tsx`/`invites-screen.tsx` 从未真的挂在
 *   `/admin/[module]` 下（那里的 `members` 键指向的是另一个文件
 *   `components/admin/members-screen.tsx`，配额/用量为主，不是本 delta 的对象，
 *   其文件头逐字写着"不改它"）——本轮的真实入口只有这一处 `/org-admin`，不存在
 *   第二套"摘除"的必要，见 PR 描述里对这条指令前提的核实记录。
 */
export function OrgAdminScreen() {
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const isAdmin = identity?.orgRole === "admin";
  // 一次性激活链接（invite-link-and-reads delta ①）：state 挂在屏幕层而不是 InvitesTab 里——
  // Tabs 切走会卸载标签页内容，挂在标签页内部时「切去成员再切回来」就把仅此一次的链接
  // 静默销毁了（独立复核 D1，数据不可恢复类）。挂在这里让它在标签页切换间存活；
  // 真正的销毁条件只有：用户点关闭、刷新/离开页面、被下一条链接覆盖。
  const [oneTimeLink, setOneTimeLink] = React.useState<OneTimeLink | null>(null);
  // 共享链接的一次性明文展示（shared-invite-links delta）：同一条 D1 纪律、同一个挂载层。
  const [sharedLinkReveal, setSharedLinkReveal] = React.useState<SharedLinkReveal | null>(null);

  return (
    <AppShell previewRole={null}>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6" data-testid="org-admin-screen">
        <div className="flex items-center gap-2">
          <Settings aria-hidden className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-16 font-semibold tracking-tight">组织管理</h1>
        </div>

        <Tabs defaultValue="teams">
          <TabsList data-testid="org-admin-tabs">
            <TabsTrigger value="teams" data-testid="org-admin-tab-teams">
              <Users aria-hidden className="h-3.5 w-3.5" />
              团队
            </TabsTrigger>
            <TabsTrigger value="members" data-testid="org-admin-tab-members">
              <UserCog aria-hidden className="h-3.5 w-3.5" />
              成员
            </TabsTrigger>
            <TabsTrigger value="invites" data-testid="org-admin-tab-invites">
              <Mail aria-hidden className="h-3.5 w-3.5" />
              邀请
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="profile" data-testid="org-admin-tab-profile">
                <Camera aria-hidden className="h-3.5 w-3.5" />
                组织资料
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="teams">
            {orgId ? <TeamsTab orgId={orgId} /> : <LoadingSkeleton rows={2} />}
          </TabsContent>

          <TabsContent value="members">
            {orgId ? <MembersTab orgId={orgId} isAdmin={isAdmin} /> : <LoadingSkeleton rows={3} />}
          </TabsContent>

          <TabsContent value="invites">
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
          </TabsContent>

          {isAdmin && (
            <TabsContent value="profile">
              {orgId ? <OrgProfileTab orgId={orgId} /> : <LoadingSkeleton rows={4} />}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
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

/** 团队标签页专用——文案是「建/改/删团队」场景下的措辞，不要挪去别的标签页用。 */
function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 403) return "当前身份无权执行此操作（HTTP 403）——只有组织管理员能建/改/删团队。";
    if (failure.status === 404) return "组织或团队不存在，或当前身份不可见（HTTP 404）。";
    return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}

/**
 * 成员/邀请/组织资料三个标签页共用——跟 `describeFailure` 的区别是这三个场景需要按
 * 数据类型（成员/邀请/组织资料）给出不同的 404/403 提示文案，不是团队那种固定措辞。
 */
function describeFailureFor(failure: unknown, notFoundHint: string, forbiddenHint: string): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 403) return `${forbiddenHint}（HTTP 403）。`;
    if (failure.status === 404) return `${notFoundHint}（HTTP 404）。`;
    return `${failure.reasonCode ?? "加载失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "加载失败，请稍后重试。";
}

/* ═══════════════════ 团队（#639 delta 迭代 2：创建/改名/删除已接线） ═══════════════════ */

function TeamsTab({ orgId }: { orgId: string }) {
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<ListTeamsOut | null>(null);
  const [banner, setBanner] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = React.useCallback(async () => {
    setState("loading");
    setFailureMessage(null);
    try {
      const result = await listTeams(orgId);
      setOut(result);
      setState(result.teams.length === 0 ? "empty" : "default");
    } catch (err) {
      setFailureMessage(describeFailure(err));
      setState("dep-failed");
    }
  }, [orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-11 text-muted-foreground">
          组织内的团队。成员加入/移出下一轮迭代开放——这里只做建团队、改名、删除。
        </p>
      </div>

      <CreateTeamForm
        orgId={orgId}
        onCreated={() => {
          setBanner({ tone: "success", text: "已创建" });
          void load();
        }}
        onFailed={(msg) => setBanner({ tone: "error", text: msg })}
      />

      {banner ? (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          data-testid="org-admin-team-banner"
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
        emptyHint="这个组织还没有任何团队。"
        depFailure={{ what: failureMessage ?? "团队列表服务暂时不可用", retry: load }}
      >
        <ul className="flex flex-col gap-1.5" data-testid="org-admin-team-list">
          {out?.teams.map((team) => (
            <TeamRow
              key={team.teamId}
              orgId={orgId}
              team={team}
              onChanged={() => void load()}
              onSuccess={(text) => setBanner({ tone: "success", text })}
              onFailed={(text) => setBanner({ tone: "error", text })}
            />
          ))}
        </ul>
      </StateShell>
    </div>
  );
}

function CreateTeamForm({
  orgId, onCreated, onFailed,
}: { orgId: string; onCreated: () => void; onFailed: (msg: string) => void }) {
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFieldError("团队名不能为空");
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      await createTeam(orgId, trimmed);
      setName("");
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "TEAM_NAME_CONFLICT") {
        setFieldError(`团队名"${trimmed}"已存在，换一个名字试试`);
      } else {
        onFailed(describeFailure(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="flex items-start gap-2"
      onSubmit={handleSubmit}
      data-testid="org-admin-create-team-form"
    >
      <div className="flex flex-1 flex-col gap-1">
        <Label htmlFor="new-team-name">新团队名称</Label>
        <Input
          id="new-team-name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
            if (fieldError) setFieldError(null);
          }}
          placeholder="新团队名称"
          disabled={submitting}
          data-testid="org-admin-create-team-input"
          aria-invalid={fieldError !== null}
        />
        {fieldError ? (
          <p role="alert" data-testid="err-team-name" className="text-10 text-destructive">{fieldError}</p>
        ) : null}
      </div>
      {/* 外层 flex-col + 一行不可见占位，抵消左侧 Label 行占用的高度，让按钮与 Input 同一水平线
          对齐（复核实测发现：加 Label 之前按钮和 Input 天然同行，加了 Label 之后 `items-start`
          会把按钮顶到跟 Label 文字同一行，是本轮 a11y 修复顺带引入的视觉退化）。 */}
      <div className="flex flex-col gap-1">
        <span aria-hidden className="text-12 leading-none">&nbsp;</span>
        <Button
          type="submit"
          size="xs"
          variant="outline"
          disabled={submitting || name.trim().length === 0}
          data-testid="org-admin-create-team"
        >
          <Plus aria-hidden className="h-3 w-3" />
          {submitting ? "创建中…" : "新建团队"}
        </Button>
      </div>
    </form>
  );
}

function TeamRow({
  orgId, team, onChanged, onSuccess, onFailed,
}: {
  orgId: string;
  team: ListTeamsOut["teams"][number];
  onChanged: () => void;
  onSuccess: (text: string) => void;
  onFailed: (text: string) => void;
}) {
  const [mode, setMode] = React.useState<"view" | "rename" | "confirm-delete">("view");
  const [name, setName] = React.useState(team.name);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFieldError("团队名不能为空");
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await renameTeam(orgId, team.teamId, trimmed);
      setMode("view");
      onSuccess("已改名");
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "TEAM_NAME_CONFLICT") {
        setFieldError(`团队名"${trimmed}"已存在，换一个名字试试`);
      } else {
        onFailed(describeFailure(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteTeam(orgId, team.teamId);
      onSuccess(`已删除"${team.name}"`);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "TEAM_NOT_EMPTY") {
        onFailed(`"${team.name}"还有 ${team.memberCount} 名成员，不能直接删除——请先把成员移到别的团队，再来删除。`);
        setMode("view");
      } else {
        onFailed(describeFailure(err));
        setMode("view");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-testid={`org-admin-team-${team.teamId}`}
      className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2"
    >
      {mode === "rename" ? (
        <form className="flex items-start gap-2" onSubmit={handleRename} data-testid={`org-admin-team-${team.teamId}-rename-form`}>
          <div className="flex flex-1 flex-col gap-1">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
                if (fieldError) setFieldError(null);
              }}
              disabled={busy}
              autoFocus
              aria-label={`重命名团队 ${team.name}`}
              data-testid={`org-admin-team-${team.teamId}-rename-input`}
              aria-invalid={fieldError !== null}
            />
            {fieldError ? (
              <p role="alert" data-testid="err-team-name" className="text-10 text-destructive">{fieldError}</p>
            ) : null}
          </div>
          <Button
            type="submit" size="xs" variant="primary" disabled={busy}
            aria-label="确认改名"
            data-testid={`org-admin-team-${team.teamId}-rename-confirm`}
          >
            <Check aria-hidden className="h-3 w-3" />
          </Button>
          <Button
            type="button" size="xs" variant="ghost" disabled={busy}
            onClick={() => { setMode("view"); setName(team.name); setFieldError(null); }}
            aria-label="取消改名"
            data-testid={`org-admin-team-${team.teamId}-rename-cancel`}
          >
            <X aria-hidden className="h-3 w-3" />
          </Button>
        </form>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-13 font-medium">{team.name}</span>
            <span className="text-10 text-muted-foreground" data-testid={`org-admin-team-${team.teamId}-member-count`}>
              {team.memberCount} 名成员
            </span>
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() => setMode("rename")}
              data-testid={`org-admin-team-${team.teamId}-rename`}
            >
              <Pencil aria-hidden className="h-3 w-3" />
              改名
            </Button>
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() => setMode("confirm-delete")}
              data-testid={`org-admin-team-${team.teamId}-delete`}
            >
              <Trash2 aria-hidden className="h-3 w-3" />
              删除
            </Button>
          </div>
        </div>
      )}

      {mode === "confirm-delete" ? (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5"
          data-testid={`org-admin-team-${team.teamId}-delete-confirm`}
        >
          <div className="flex items-center gap-1.5 text-11 text-destructive">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span>
              确认删除&quot;{team.name}&quot;？
              {team.memberCount > 0 ? `它还有 ${team.memberCount} 名成员，需要先清空才能删除。` : "此操作不可撤销。"}
            </span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button" size="xs" variant="destructive" disabled={busy}
              onClick={handleDelete}
              data-testid={`org-admin-team-${team.teamId}-delete-confirm-yes`}
            >
              {busy ? "删除中…" : "确认删除"}
            </Button>
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() => setMode("view")}
              data-testid={`org-admin-team-${team.teamId}-delete-confirm-no`}
            >
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ═══════════════════════════════ 成员（#363，真实数据） ═══════════════════════════════ */

/**
 * issue #852 —— 「Skill 审核人职能」下拉，只在 `isAdmin` 时渲染成可操作控件。
 * 非 admin 完全看不到这一列（同 `listSkillReviewerFunctions` 契约仅 admin 可读的既定
 * 纪律：「谁能审我」不是给提交人看的信息，不只是「看得到但按不动」）。
 */
function ReviewerFunctionPicker({
  orgId, userId, current, onChanged,
}: {
  orgId: string;
  userId: string;
  current: SkillReviewerFunctionValue | null;
  onChanged: (userId: string, next: SkillReviewerFunctionValue | null) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value as SkillReviewerFunctionValue | "";
    setBusy(true);
    setError(null);
    try {
      if (value === "") {
        await revokeSkillReviewerFunction(orgId, userId);
        onChanged(userId, null);
      } else {
        await assignSkillReviewerFunction(orgId, userId, value);
        onChanged(userId, value);
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        className="h-7 rounded-md border border-input bg-panel px-1.5 text-11 disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"
        value={current ?? ""}
        disabled={busy}
        onChange={(e) => void handleChange(e)}
        data-testid={`org-admin-member-${userId}-reviewer-function`}
      >
        <option value="">无审核职能</option>
        <option value="methodology-reviewer">方法论审核人</option>
        <option value="security-reviewer">安全评审人</option>
      </select>
      {error && (
        <span className="text-10 text-destructive" data-testid={`org-admin-member-${userId}-reviewer-function-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

/** 导出供测试直接渲染，不必连 `useSession` 一起 mock 出整个 `OrgAdminScreen`。 */
export function MembersTab({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<ListOrgMembersOut | null>(null);
  // issue #852：`userId → 当前职能` 表。未列出 ⇒ 未指派。仅 admin 会真的发起这条请求
  // ——非 admin 调用 `listSkillReviewerFunctions` 会拿到 403，这里干脆不发那次请求。
  const [reviewerFunctions, setReviewerFunctions] = React.useState<Record<string, SkillReviewerFunctionValue>>({});

  const load = React.useCallback(async () => {
    setState("loading");
    setFailureMessage(null);
    try {
      const result = await listOrgMembers(orgId);
      setOut(result);
      setState(result.members.length === 0 ? "empty" : "default");
    } catch (err) {
      setFailureMessage(describeFailureFor(err, "组织不存在或当前身份不可见", "当前身份无权读取成员列表"));
      setState("dep-failed");
    }
    if (isAdmin) {
      try {
        const { assignments } = await listSkillReviewerFunctions(orgId);
        setReviewerFunctions(Object.fromEntries(assignments.map((a) => [a.userId, a.reviewerFunction])));
      } catch {
        // 职能名单读失败不该把整块成员列表也带走——那是另一件事的失败。
        setReviewerFunctions({});
      }
    }
  }, [orgId, isAdmin]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleReviewerFunctionChanged = (userId: string, next: SkillReviewerFunctionValue | null) => {
    setReviewerFunctions((prev) => {
      if (next === null) {
        const { [userId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [userId]: next };
    });
  };

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-11 text-muted-foreground">组织内的成员。任何组织成员均可查看这份名单。</p>
      <StateShell
        state={state}
        emptyHint="这个组织还没有其他成员。"
        depFailure={{ what: failureMessage ?? "成员列表服务暂时不可用", retry: load }}
      >
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="org-admin-member-list">
          {out?.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`org-admin-member-${m.userId}`}>
              <Avatar initials={m.displayName.slice(0, 1)} size="sm" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-13 font-medium" data-testid={`org-admin-member-${m.userId}-name`}>{m.displayName}</span>
                <span className="truncate text-10 text-muted-foreground">{m.email}</span>
              </div>
              <Badge tone={m.orgRole === "admin" ? "danger" : "neutral"} className="ml-1">
                {ORG_ROLE_LABEL[m.orgRole]}
              </Badge>
              {m.status === "suspended" && <Badge tone="outline">已停用</Badge>}
              {/* issue #852：职能指派仅 admin 可见可改——`listSkillReviewerFunctions` 契约本身
                  就是仅 admin 可读（同「谁能审我」不给提交人看的既定纪律），非 admin 这里
                  不渲染任何东西，不是「看得到但按不动」。 */}
              {isAdmin && (
                <ReviewerFunctionPicker
                  orgId={orgId}
                  userId={m.userId}
                  current={reviewerFunctions[m.userId] ?? null}
                  onChanged={handleReviewerFunctionChanged}
                />
              )}
              <span className="ml-auto text-10 text-muted-foreground" data-testid={`org-admin-member-${m.userId}-joined`}>
                {new Date(m.joinedAt).toLocaleDateString("zh-CN")} 加入
              </span>
            </li>
          ))}
        </ul>
      </StateShell>
    </div>
  );
}

/* ═══════════════════════════════ 邀请（#363，仅 admin） ═══════════════════════════════ */

const INVITE_STATUS_LABEL: Record<string, string> = {
  pending: "待接受",
  "awaiting-review": "待复核",
  revoked: "已撤销",
  used: "已使用",
  "send-failed": "发送失败",
};

/**
 * 邀请相关写操作的错误码 → 人话。撑开 `describeFailureFor` 覆盖不到的邀请专属语义
 * （错误码全部来自契约 `inviteOrgMember`/`resendOrgInvite`/`revokeOrgInvite`/
 * `reviewAdminInvite` 的 `err` 声明，不是这里发明的）。
 */
function describeInviteFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    switch (failure.reasonCode) {
      case "INVITE_ALREADY_MEMBER":
        return "该邮箱已是组织成员，无需邀请。";
      case "INVITE_DUPLICATE":
        return "该邮箱已有一条未完成的邀请（角色或团队与本次不同）。可在下方列表对它重发，或先撤销再按新角色重新邀请。";
      case "QUOTA_EXHAUSTED":
        return "组织成员配额已用尽，本次邀请未发出。请先释放名额（撤销未使用的邀请或移除成员）再试。";
      case "MAIL_UNAVAILABLE":
        return "邮件服务不可用：邀请已记录为「发送失败」，不会产生可用链接的假象。邮件服务恢复后可在列表里对它「重发」。";
      case "RATE_LIMITED":
        return `重发太频繁：每 ${authContract.AUTH_POLICY.resendCooldownSeconds} 秒最多一次、24 小时最多 ${authContract.AUTH_POLICY.resendDailyMax} 次。稍后再试。`;
      case "INVITE_SELF_REVIEW_FORBIDDEN":
        return "不能复核自己发起的邀请（双人复核），需要另一位管理员来批准或拒绝。";
      case "VERSION_CHANGED":
        return "邀请状态已发生变化（可能已被其他管理员处理、已使用或已撤销），列表已刷新。";
      case "INVITE_NOT_FOUND":
        return "邀请不存在或当前身份不可见。";
      case "PROJECT_ROLE_INSUFFICIENT":
        return "只有组织管理员能执行此操作（HTTP 403）。";
      case "NO_ORG_MEMBERSHIP":
        return "你不是该组织的成员（HTTP 403）。";
    }
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 403) return "当前身份无权执行此操作（HTTP 403）。";
    return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
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
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const currentLabel = options.find((o) => o.id === value)?.label ?? value;

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        size="xs"
        variant="outline"
        data-testid={testid}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}，当前：${currentLabel}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-full justify-between gap-1 rounded-md pl-2.5 pr-2 text-12 font-normal"
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
                setOpen(false);
              }}
              className={[
                "flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 hover:bg-muted",
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

/** 一次性激活链接的展示载荷（invite-link-and-reads delta ①）。 */
type OneTimeLink = {
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
function OneTimeActivationLink({ link, onDismiss }: { link: OneTimeLink; onDismiss: () => void }) {
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
      aria-label="一次性激活链接"
    >
      <p className="text-12 font-medium">
        {link.kind === "resent"
          ? `已对 ${link.email} 重发——新的激活链接：`
          : link.kind === "approved"
            ? `已批准——${link.email} 的激活链接：`
            : `${link.email} 的激活链接：`}
      </p>
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          readOnly
          value={link.url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 flex-1 font-mono text-11"
          aria-label="激活链接（只显示这一次）"
          data-testid="org-admin-invite-link-url"
        />
        <Button type="button" size="xs" variant="primary" onClick={() => void copy()} data-testid="org-admin-invite-link-copy">
          <Copy aria-hidden className="h-3 w-3" />
          {copyState === "copied" ? "已复制" : "复制"}
        </Button>
      </div>
      {copyState === "copied" && (
        <p role="status" className="text-10 text-success" data-testid="org-admin-invite-link-copied">
          已复制到剪贴板，请发给受邀人。
        </p>
      )}
      {copyState === "failed" && (
        <p role="alert" className="text-10 text-destructive" data-testid="org-admin-invite-link-copy-failed">
          浏览器拒绝了自动复制——链接已全选，请按 Ctrl/Cmd+C 手动复制。
        </p>
      )}
      <p className="text-10 text-warning" data-testid="org-admin-invite-link-once-note">
        链接只显示这一次，请立即复制并转交受邀人（邮件通道尚未接通，送达由你完成）。
        {link.kind === "resent" ? "旧链接已同时作废。" : ""}
        点「关闭」、刷新或离开本页面后无法找回（切换上方标签页不会丢失），只能用「重发」生成新链接（旧链接将作废）。
      </p>
      <div>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss} data-testid="org-admin-invite-link-dismiss">
          我已转交，关闭
        </Button>
      </div>
    </div>
  );
}

/** 团队下拉里「不分团队」的哨兵值——提交时映射为契约要求的空串（controller 把空串转 null）。 */
const NO_TEAM = "";

const ORG_ROLE_OPTIONS: ReadonlyArray<{ id: OrgRole; label: string }> = (
  ["consultant", "lead", "compliance", "admin"] as const
).map((r) => ({ id: r, label: ORG_ROLE_LABEL[r] }));

// export 仅供 `tests/ui/org-admin-invite-form-novalidate.test.tsx` 机械钉 noValidate（两次复发的 bug），别在别处 import。
export function InviteMemberForm({
  orgId, onSucceeded, onFailed, onLink,
}: {
  orgId: string;
  onSucceeded: (text: string) => void;
  onFailed: (text: string) => void;
  /** 签发成功且响应带一次性 token 时回调（invite-link-and-reads delta ①）。 */
  onLink: (link: OneTimeLink) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [orgRole, setOrgRole] = React.useState<OrgRole>("consultant");
  const [teamId, setTeamId] = React.useState<string>(NO_TEAM);
  const [teams, setTeams] = React.useState<ListTeamsOut["teams"] | null>(null);
  const [teamsFailed, setTeamsFailed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listTeams(orgId);
        if (!cancelled) setTeams(result.teams);
      } catch {
        // 团队列表拉不到不阻塞邀请本身——降级为只能「不分团队」，并如实说明。
        if (!cancelled) {
          setTeams([]);
          setTeamsFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const teamOptions = React.useMemo(
    () => [
      { id: NO_TEAM, label: "不分团队" },
      ...(teams ?? []).map((t) => ({ id: t.teamId, label: t.name })),
    ],
    [teams],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setFieldError("邮箱不能为空");
      return;
    }
    if (!trimmed.includes("@")) {
      setFieldError(`「${trimmed}」不是合法邮箱`);
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const out = await inviteOrgMember({ orgId, email: trimmed, orgRole, teamId });
      setEmail("");
      if (out.status === "awaiting-review") {
        onSucceeded(
          `已受理对 ${trimmed} 的管理员邀请：进入双人复核（待复核），另一位管理员批准后才会签发激活链接。`,
        );
      } else if (out.quotaReserved === 0) {
        // 幂等重放：服务端刻意不把既有令牌再吐一次（否则任何管理员都能凭「再邀一次」
        // 读走别人的激活链接），所以这里也没有链接可展示。
        onSucceeded(
          `该邮箱此前已有相同的邀请，本次返回既有邀请（未新建、未重复扣配额）。需要新链接请在列表里「重发」。`,
        );
      } else {
        onSucceeded(`邀请已创建，激活链接已签发（7 天有效）——见下方，只显示这一次。`);
        if (out.activationToken !== null) {
          onLink({ email: trimmed, url: buildActivationLink(out.activationToken, window.location.origin), kind: "invited" });
        }
      }
    } catch (err) {
      // delta ③：契约层的邮箱 400（`ZodBodyPipe` validation_failed，path = email）
      // 映射成能看懂的字段级文案，不掉进「操作失败（HTTP 400）」的兜底。
      if (contractFieldIssues(err)?.some((i) => i.path === "email")) {
        setFieldError(`「${trimmed}」不是合法邮箱（服务端校验拒绝，未创建邀请）。`);
      } else if (err instanceof ApiError && (err.reasonCode === "INVITE_ALREADY_MEMBER" || err.reasonCode === "INVITE_DUPLICATE")) {
        setFieldError(describeInviteFailure(err));
      } else {
        onFailed(describeInviteFailure(err));
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
          <Label htmlFor="org-admin-invite-email">受邀人邮箱</Label>
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
            <p role="alert" data-testid="err-invite-email" className="text-10 text-destructive">{fieldError}</p>
          ) : null}
        </div>
        <div className="flex w-32 flex-col gap-1">
          <Label id="org-admin-invite-role-label">组织角色</Label>
          <PopoverSelect
            value={orgRole}
            options={ORG_ROLE_OPTIONS}
            onSelect={(id) => setOrgRole(id as OrgRole)}
            disabled={submitting}
            testid="org-admin-invite-role"
            ariaLabel="组织角色"
          />
        </div>
        <div className="flex w-36 flex-col gap-1">
          <Label id="org-admin-invite-team-label">团队</Label>
          <PopoverSelect
            value={teamId}
            options={teamOptions}
            onSelect={setTeamId}
            disabled={submitting || teams === null}
            testid="org-admin-invite-team"
            ariaLabel="团队"
          />
        </div>
      </div>

      {teamsFailed && (
        <p className="text-10 text-warning" data-testid="org-admin-invite-teams-degraded">
          团队列表暂时拉不到，本次只能按「不分团队」邀请；需要指定团队请稍后重试。
        </p>
      )}
      {orgRole === "admin" && (
        <p className="text-10 text-muted-foreground" data-testid="org-admin-invite-dual-review-note">
          邀请管理员需双人复核：提交后进入「待复核」，由另一位管理员批准后才签发激活链接（发起人不能自批）。
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-10 text-muted-foreground">
          邮件通道尚未接通：邀请成功后，激活链接会在下方显示<strong>一次</strong>，由你复制并转交受邀人。
        </p>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={submitting || email.trim().length === 0}
          data-testid="org-admin-invite-submit"
        >
          <Send aria-hidden className="h-3.5 w-3.5" />
          {submitting ? "邀请中…" : "发出邀请"}
        </Button>
      </div>
    </form>
  );
}

function InviteRow({
  orgId, invite, currentUserId, onChanged, onSucceeded, onFailed, onLink,
}: {
  orgId: string;
  invite: ListOrgInvitesOut["invites"][number];
  /** 当前登录用户 id——判「这条邀请是不是我发起的」（delta ②）。 */
  currentUserId: string | null;
  onChanged: () => void;
  onSucceeded: (text: string) => void;
  onFailed: (text: string) => void;
  onLink: (link: OneTimeLink) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = React.useState(false);

  // 状态门与后端一致（`pg-org-invite-repository.ts`）：
  //   重发：pending / send-failed（awaiting-review 重发会绕过双人复核，后端拒）
  //   撤销：revoked（幂等）与 used（人已进来）之外都可以；已翻状态的不给按钮
  //   复核：仅 awaiting-review，且**发起人不渲染批准/拒绝**（delta ②，coord-main 裁决）：
  //   I-4 自批必被后端 403，此前列表不含发起人 id、只能渲染一颗点了必失败的死按钮，
  //   现在契约带 `invitedByUserId`，发起人视角直接换成等待说明。
  const canResend = invite.status === "pending" || invite.status === "send-failed";
  const canRevoke = invite.status === "pending" || invite.status === "awaiting-review" || invite.status === "send-failed";
  const isInitiator = currentUserId !== null && invite.invitedByUserId === currentUserId;
  const canReview = invite.status === "awaiting-review" && !isInitiator;
  const waitingPeerReview = invite.status === "awaiting-review" && isInitiator;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      const text = await action();
      onSucceeded(text);
      onChanged();
    } catch (err) {
      onFailed(describeInviteFailure(err));
      if (err instanceof ApiError && err.reasonCode === "VERSION_CHANGED") onChanged();
    } finally {
      setBusy(false);
      setConfirmingRevoke(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2" data-testid={`org-admin-invite-${invite.inviteId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-13 font-medium">{invite.email}</span>
        <Badge tone={invite.status === "pending" ? "warning" : invite.status === "used" ? "primary" : invite.status === "revoked" ? "outline" : "danger"}>
          {INVITE_STATUS_LABEL[invite.status] ?? invite.status}
        </Badge>
        <span className="text-10 text-muted-foreground">由 {invite.invitedBy} 邀请</span>
        <span className="ml-auto text-10 text-muted-foreground" data-testid={`org-admin-invite-${invite.inviteId}-expires`}>
          {new Date(invite.expiresAt).toLocaleDateString("zh-CN")} 到期
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {waitingPeerReview && (
            <span
              className="flex items-center gap-1 text-10 text-muted-foreground"
              data-testid={`org-admin-invite-${invite.inviteId}-waiting-peer-review`}
            >
              <Hourglass aria-hidden className="h-3 w-3" />
              你发起的邀请：等待另一位管理员复核（不能自批）
            </span>
          )}
          {canReview && (
            <>
              <Button
                type="button" size="xs" variant="primary" disabled={busy}
                onClick={() =>
                  run(async () => {
                    // D2 裁决 A：批准响应带一次性 activationToken（与 delta ① 同一语义），
                    // 批准人当场拿到链接转交——不再逼他撞 60 秒重发冷却。
                    const out = await reviewAdminInvite({ orgId, inviteId: invite.inviteId, decision: "approve", reason: null });
                    if (out.activationToken !== null) {
                      onLink({
                        email: invite.email,
                        url: buildActivationLink(out.activationToken, window.location.origin),
                        kind: "approved",
                      });
                    }
                    return `已批准对 ${invite.email} 的管理员邀请，激活链接已签发（7 天有效）——见下方，只显示这一次。`;
                  })
                }
                data-testid={`org-admin-invite-${invite.inviteId}-approve`}
              >
                <Check aria-hidden className="h-3 w-3" />
                批准
              </Button>
              <Button
                type="button" size="xs" variant="outline" disabled={busy}
                onClick={() =>
                  run(async () => {
                    await reviewAdminInvite({ orgId, inviteId: invite.inviteId, decision: "reject", reason: null });
                    return `已拒绝对 ${invite.email} 的管理员邀请。`;
                  })
                }
                data-testid={`org-admin-invite-${invite.inviteId}-reject`}
              >
                <X aria-hidden className="h-3 w-3" />
                拒绝
              </Button>
            </>
          )}
          {canResend && (
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() =>
                run(async () => {
                  const out = await resendOrgInvite(orgId, invite.inviteId);
                  onLink({
                    email: invite.email,
                    url: buildActivationLink(out.activationToken, window.location.origin),
                    kind: "resent",
                  });
                  return `已对 ${invite.email} 重发：新链接已签发（见下方，只显示这一次）、旧链接当场作废（冷却 ${out.cooldownSec} 秒）。`;
                })
              }
              data-testid={`org-admin-invite-${invite.inviteId}-resend`}
            >
              <RotateCcw aria-hidden className="h-3 w-3" />
              重发
            </Button>
          )}
          {canRevoke && !confirmingRevoke && (
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              className="text-destructive"
              onClick={() => setConfirmingRevoke(true)}
              data-testid={`org-admin-invite-${invite.inviteId}-revoke`}
            >
              <Ban aria-hidden className="h-3 w-3" />
              撤销
            </Button>
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
            <span>确认撤销对 {invite.email} 的邀请？其激活链接将立即失效，且不会通知受邀人。</span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button" size="xs" variant="destructive" disabled={busy}
              onClick={() =>
                run(async () => {
                  await revokeOrgInvite(orgId, invite.inviteId);
                  return `已撤销对 ${invite.email} 的邀请，激活链接立即失效。`;
                })
              }
              data-testid={`org-admin-invite-${invite.inviteId}-revoke-confirm-yes`}
            >
              {busy ? "撤销中…" : "确认撤销"}
            </Button>
            <Button
              type="button" size="xs" variant="ghost" disabled={busy}
              onClick={() => setConfirmingRevoke(false)}
              data-testid={`org-admin-invite-${invite.inviteId}-revoke-confirm-no`}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function InvitesTab({
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
  const { session } = useSession();
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<ListOrgInvitesOut | null>(null);
  const [banner, setBanner] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);

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
      setFailureMessage(describeFailureFor(err, "组织不存在或当前身份不可见", "当前身份无权读取邀请列表"));
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
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-11 text-muted-foreground">
        发出的邀请及其状态。仅组织管理员可查看——比成员名单更严格（未接受的邀请邮箱不对全体成员开放）。
      </p>

      {/* 表单跟随标签页同一权限判定：非 admin 会在下方 StateShell 看到真实 403 的无权限态，
          这里就不再渲染一个必然失败的表单（发起邀请后端仅 admin 可做）。 */}
      {isAdmin && (
        <InviteMemberForm
          orgId={orgId}
          onSucceeded={(text) => {
            setBanner({ tone: "success", text });
            void load();
          }}
          onFailed={(text) => setBanner({ tone: "error", text })}
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
          {banner.text}
        </div>
      ) : null}

      <StateShell
        state={state}
        emptyHint="还没有发出过邀请。"
        depFailure={{ what: failureMessage ?? "邀请列表服务暂时不可用", retry: load }}
        denial={{ layer: "organization", reason: "邀请列表仅组织管理员可读；你在本组织不是管理员。" }}
      >
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="org-admin-invite-list">
          {out?.invites.map((inv) => (
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
        </ul>
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
        <p className="text-10 text-muted-foreground">（当前身份非组织管理员，若上方出现内容属于预览态误判，请以服务端 403 为准。）</p>
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
  const { updateOrgName } = useSession();
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<UpdateOrganizationOut | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [invalidFields, setInvalidFields] = React.useState<Record<string, string>>({});
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
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
      setFailureMessage(describeFailureFor(err, "组织不存在", "当前身份无权编辑组织资料"));
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
    const violations: Record<string, string> = {};
    if (trimmed.length === 0) violations.name = "组织名称不能为空";
    if (description.length > DESCRIPTION_MAX) violations.description = `简介不能超过 ${DESCRIPTION_MAX} 字`;
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
      setFailureMessage(describeFailureFor(err, "组织不存在", "当前身份无权编辑组织资料"));
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
        if (err.reasonCode === "FILE_TOO_LARGE") setAvatarError("图片超过 5MB 上限，服务端已拒绝，未上传。");
        else if (err.reasonCode === "UNSUPPORTED_CONTENT_TYPE") setAvatarError("文件内容与声明的图片格式不符（服务端按真实字节校验），未上传。");
        else setAvatarError(`上传失败：${err.reasonCode ?? err.status}`);
      } else if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        // 2026-08-11 devapp 实测：请求可能永远不返回（见 live-org-admin.ts 的硬超时）。
        // 超时必须给出明确反馈，不许停在「上传中…」。
        setAvatarError("上传超时，请重试。");
      } else {
        setAvatarError("上传失败，请稍后重试。");
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
        errors={invalidFields}
        depFailure={{ what: failureMessage ?? "组织资料服务暂时不可用", retry: load }}
        denial={{ layer: "organization", reason: "组织资料编辑仅组织管理员可进；你在本组织不是管理员。" }}
        successMessage="已保存"
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3" data-testid="org-admin-avatar-block">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 组织头像来自后端 object store，非 Next 静态资源
              <img
                src={avatarSrc}
                alt={`${profile?.name ?? "组织"} 头像`}
                className="h-9 w-9 rounded-full object-cover"
                data-testid="org-admin-avatar-image"
              />
            ) : (
              <Avatar initials={(profile?.name ?? "组").slice(0, 1)} size="lg" />
            )}
            <div className="flex flex-col gap-1">
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
                {avatarUploading ? "上传中…" : "更换头像"}
              </Button>
              <p className="text-10 text-muted-foreground">PNG / JPEG / WebP，最大 5MB。</p>
              {avatarSavedNotice && (
                <p role="status" data-testid="org-admin-avatar-saved" className="text-10 text-success">
                  已上传
                </p>
              )}
              {avatarError && (
                <p role="alert" data-testid="org-admin-avatar-error" className="text-10 text-destructive">
                  {avatarError}
                </p>
              )}
            </div>
          </div>

          <form className="flex flex-col gap-4" onSubmit={handleSave} data-testid="org-admin-profile-form">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-admin-name">组织名称</Label>
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
              <Label htmlFor="org-admin-description">组织简介</Label>
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
                纯文本，不支持 markdown（{description.length}/{DESCRIPTION_MAX}）。
              </p>
            </div>

            <div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={state === "loading" || !dirty}
                data-testid="org-admin-profile-save"
              >
                {state === "loading" ? "保存中…" : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </StateShell>
    </div>
  );
}
