"use client";

import * as React from "react";
import { AlertTriangle, Check, Pencil, Plus, Settings, Trash2, Users, X } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import {
  createTeam, deleteTeam, listTeams, renameTeam, type ListTeamsOut,
} from "@/lib/live-org-admin";

/**
 * `/org-admin` —— 组织管理页（#639 delta；迭代 1 只读列表，迭代 2 接上创建/改名/删除）。
 *
 * ## 明确排除（本轮不做，跟随 delta「明确排除」一节）
 * 团队成员加入/移出（`org_memberships.team_id` 写路径）不在本轮——列表里每个团队
 * 只显示人数，没有"添加成员"入口，避免暗示这个功能存在。
 */
export function OrgAdminScreen() {
  const { session } = useSession();
  const orgId = session?.currentOrgId ?? null;

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
          </TabsList>

          <TabsContent value="teams">
            {orgId ? <TeamsTab orgId={orgId} /> : (
              <div data-testid="loading" className="flex animate-pulse flex-col gap-2 pt-3">
                <div className="h-10 rounded-lg bg-muted" />
                <div className="h-10 rounded-lg bg-muted" />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

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
        <Input
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
              data-testid={`org-admin-team-${team.teamId}-rename-input`}
              aria-invalid={fieldError !== null}
            />
            {fieldError ? (
              <p role="alert" data-testid="err-team-name" className="text-10 text-destructive">{fieldError}</p>
            ) : null}
          </div>
          <Button type="submit" size="xs" variant="primary" disabled={busy} data-testid={`org-admin-team-${team.teamId}-rename-confirm`}>
            <Check aria-hidden className="h-3 w-3" />
          </Button>
          <Button
            type="button" size="xs" variant="ghost" disabled={busy}
            onClick={() => { setMode("view"); setName(team.name); setFieldError(null); }}
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

function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 403) return "当前身份无权执行此操作（HTTP 403）——只有组织管理员能建/改/删团队。";
    if (failure.status === 404) return "组织或团队不存在，或当前身份不可见（HTTP 404）。";
    return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}
