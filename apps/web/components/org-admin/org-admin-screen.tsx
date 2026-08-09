"use client";

import * as React from "react";
import { AlertTriangle, Camera, Check, Mail, Pencil, Plus, Settings, Trash2, UserCog, Users, X } from "lucide-react";
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
import { ApiError, apiBaseUrl, getStoredSessionToken } from "@/lib/api-client";
import { ORG_ROLE_LABEL } from "@/lib/identity";
import {
  createTeam, deleteTeam, listTeams, renameTeam, listOrgMembers, listOrgInvites,
  updateOrganization, uploadOrgAvatar,
  type ListTeamsOut, type ListOrgMembersOut, type ListOrgInvitesOut, type UpdateOrganizationOut,
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
            {orgId ? <MembersTab orgId={orgId} /> : <LoadingSkeleton rows={3} />}
          </TabsContent>

          <TabsContent value="invites">
            {orgId ? <InvitesTab orgId={orgId} isAdmin={isAdmin} /> : <LoadingSkeleton rows={3} />}
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

function MembersTab({ orgId }: { orgId: string }) {
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<ListOrgMembersOut | null>(null);

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
  }, [orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

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

function InvitesTab({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<ListOrgInvitesOut | null>(null);

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

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-11 text-muted-foreground">
        发出的邀请及其状态。仅组织管理员可查看——比成员名单更严格（未接受的邀请邮箱不对全体成员开放）。
      </p>
      <StateShell
        state={state}
        emptyHint="还没有发出过邀请。"
        depFailure={{ what: failureMessage ?? "邀请列表服务暂时不可用", retry: load }}
        denial={{ layer: "organization", reason: "邀请列表仅组织管理员可读；你在本组织不是管理员。" }}
      >
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="org-admin-invite-list">
          {out?.invites.map((inv) => (
            <li key={inv.inviteId} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`org-admin-invite-${inv.inviteId}`}>
              <span className="truncate text-13 font-medium">{inv.email}</span>
              <Badge tone={inv.status === "pending" ? "warning" : inv.status === "used" ? "primary" : inv.status === "revoked" ? "outline" : "danger"}>
                {INVITE_STATUS_LABEL[inv.status] ?? inv.status}
              </Badge>
              <span className="text-10 text-muted-foreground">由 {inv.invitedBy} 邀请</span>
              <span className="ml-auto text-10 text-muted-foreground" data-testid={`org-admin-invite-${inv.inviteId}-expires`}>
                {new Date(inv.expiresAt).toLocaleDateString("zh-CN")} 到期
              </span>
            </li>
          ))}
        </ul>
      </StateShell>
      {!isAdmin && state !== "denied" && (
        <p className="text-10 text-muted-foreground">（当前身份非组织管理员，若上方出现内容属于预览态误判，请以服务端 403 为准。）</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════ 组织资料（#363，仅 admin） ═══════════════════════════════ */

const DESCRIPTION_MAX = 500;

/**
 * 组织头像走**受鉴权**的 `GET /organizations/:orgId/avatar-file/:id`（`@CurrentPrincipal`
 * 门控，见 controller 文件头注释）——裸 `<img src>` 发不出 `Authorization` 头，直接指向
 * 这条路由会永远拿到 401、图裂掉（D9 实测：curl 不带 Authorization → 401；带 → 200）。
 * 与本仓其余真实请求同一条纪律（`api-client.ts`：Bearer token 不是 cookie）——手动
 * `fetch` 带上头，拉 blob，`URL.createObjectURL()` 出一个本地 blob URL 再喂给 `<img>`。
 */
function useAuthedImageSrc(url: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!url) {
      setSrc(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    (async () => {
      try {
        // 鉴权是 Bearer token，不是 cookie（同 `api-client.ts` 文件头那条纪律）——
        // 不需要 `credentials: "include"`，`Authorization` 头本身就带着身份。
        const token = getStoredSessionToken();
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error(`http_${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) {
          setSrc(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return { src, failed };
}

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
      // D5：图片本身要靠鉴权 fetch 异步拉回来才显示（见 `useAuthedImageSrc`），中间那段
      // 时间用户不该完全没反馈——补一条显式的成功提示，2.5s 后自动收起。
      setAvatarSavedNotice(true);
      window.setTimeout(() => setAvatarSavedNotice(false), 2500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.reasonCode === "FILE_TOO_LARGE") setAvatarError("图片超过 5MB 上限，服务端已拒绝，未上传。");
        else if (err.reasonCode === "UNSUPPORTED_CONTENT_TYPE") setAvatarError("文件内容与声明的图片格式不符（服务端按真实字节校验），未上传。");
        else setAvatarError(`上传失败：${err.reasonCode ?? err.status}`);
      } else {
        setAvatarError("上传失败，请稍后重试。");
      }
    } finally {
      setAvatarUploading(false);
    }
  }

  const avatarUrl = profile?.avatarUrl ? `${apiBaseUrl()}${profile.avatarUrl}` : null;
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
