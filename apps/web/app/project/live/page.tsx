"use client";

/**
 * F122 —— `/project/live`：全仓第一条真正端到端的路径。
 *
 * ## 为什么是新路由，不是把 `/projects` 接上真数据
 *
 * `apps/web/app/projects/page.tsx` + `components/projects/projects-screen.tsx` 是
 * 已经画好的原型屏：七态门控、`?state=` 预览开关、`MOCK_PROJECTS` 的字段
 * （`ProjectCardState`、`readiness`、`stageProgress`……）与契约的 `ProjectListItem`
 * （`id/name/kind/status/readOnlyReason`）形状完全不同——前者是 UI 原型阶段
 * 编出来的展示字段，后者是 F122 契约签核过的响应体。硬接上意味着要么现在把
 * 那些展示字段的出处都编出来（`design-coherence.md:200` 点名过的事故：编一个
 * 看起来算过的数），要么假装它们不存在。这两个都不是这次要交付的东西。
 *
 * 这里新开一条干净路由，只做一件事：证明「填表单 → 提交 → 刷新列表 → 看到它」
 * 这条路径在真实 HTTP + 真实 Postgres 上成立。等 `/projects` 的展示字段各自有了
 * 出处（准备度口径、蓝本名等），把这个页面的数据源接上去才有意义。
 *
 * ## 登录：真实 `POST /auth/login`，不是测试注入头
 *
 * `apps/web` 目前没有任何登录 UI（已确认：`app/` 下没有 `login` 路由）。
 * 本页面内嵌一个最小登录表单，直接调真实的 `/auth/login`——这是本仓唯一的
 * 真实鉴权入口，token 存进 `localStorage`。种子账号见 issue #103 的实现说明。
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, clearStoredSessionToken, getStoredSessionToken, storeSessionToken } from "@/lib/api-client";
import {
  PROJECT_KIND_OPTIONS,
  createProject,
  listProjects,
  login,
  type ProjectListItem,
} from "@/lib/live-projects";

function ProjectRow({ item }: { item: ProjectListItem }) {
  return (
    <li
      data-testid={`live-project-item-${item.id}`}
      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-13"
    >
      <span className="font-medium">{item.name}</span>
      <span className="flex items-center gap-2 text-12 text-muted-foreground">
        <span data-testid={`live-project-kind-${item.id}`}>{item.kind}</span>
        <span data-testid={`live-project-status-${item.id}`}>{item.status}</span>
        {item.readOnlyReason !== null ? (
          <span
            data-testid={`live-project-readonly-${item.id}`}
            className="rounded bg-muted px-1.5 py-0.5"
          >
            只读 · {item.readOnlyReason === "archived" ? "已归档" : "组织已停用"}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export default function ProjectLivePage() {
  const [sessionToken, setSessionToken] = React.useState<string | null>(null);
  const [orgId, setOrgId] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginBusy, setLoginBusy] = React.useState(false);

  const [segments, setSegments] = React.useState<{ member: ProjectListItem[]; managed: ProjectListItem[] } | null>(
    null,
  );
  const [listError, setListError] = React.useState<string | null>(null);
  const [listBusy, setListBusy] = React.useState(false);

  const [newName, setNewName] = React.useState("");
  const [newKind, setNewKind] = React.useState<(typeof PROJECT_KIND_OPTIONS)[number]>(
    PROJECT_KIND_OPTIONS[0],
  );
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createBusy, setCreateBusy] = React.useState(false);

  // 页面加载时从 localStorage 恢复已登录状态——刷新页面不该要求重新登录。
  React.useEffect(() => {
    setSessionToken(getStoredSessionToken());
  }, []);

  const refresh = React.useCallback(
    async (org: string) => {
      setListBusy(true);
      setListError(null);
      try {
        const out = await listProjects(org);
        setSegments({ member: [...out.member], managed: [...out.managed] });
      } catch (e) {
        setListError(describeError(e));
        setSegments(null);
      } finally {
        setListBusy(false);
      }
    },
    [],
  );

  async function handleLogin(ev: React.FormEvent) {
    ev.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    try {
      const out = await login(email, password);
      storeSessionToken(out.sessionToken);
      setSessionToken(out.sessionToken);
      const firstOrg = out.orgs[0];
      if (firstOrg !== undefined && orgId === "") {
        setOrgId(firstOrg);
        await refresh(firstOrg);
      }
    } catch (e) {
      setLoginError(describeError(e));
    } finally {
      setLoginBusy(false);
    }
  }

  function handleLogout() {
    clearStoredSessionToken();
    setSessionToken(null);
    setSegments(null);
  }

  async function handleCreate(ev: React.FormEvent) {
    ev.preventDefault();
    if (orgId === "" || newName.trim() === "") return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createProject({ orgId, name: newName.trim(), kind: newKind, blueprintVersionId: null });
      setNewName("");
      await refresh(orgId);
    } catch (e) {
      setCreateError(describeError(e));
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div data-testid="project-live-page" className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-16 font-semibold">项目列表（真实数据，F122）</h1>

      {sessionToken === null ? (
        <Card data-testid="live-login-card">
          <CardHeader>
            <CardTitle>登录</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-2" onSubmit={handleLogin}>
              <Input
                data-testid="live-login-email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                data-testid="live-login-password"
                placeholder="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button data-testid="live-login-submit" type="submit" disabled={loginBusy}>
                {loginBusy ? "登录中…" : "登录"}
              </Button>
              {loginError !== null ? (
                <p data-testid="live-login-error" className="text-12 text-destructive">
                  {loginError}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Input
              data-testid="live-org-id"
              placeholder="组织 id"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="max-w-xs"
            />
            <Button data-testid="live-refresh" onClick={() => refresh(orgId)} disabled={orgId === "" || listBusy}>
              {listBusy ? "加载中…" : "刷新列表"}
            </Button>
            <Button data-testid="live-logout" variant="ghost" onClick={handleLogout}>
              退出登录
            </Button>
          </div>

          {listError !== null ? (
            <p data-testid="live-list-error" className="text-12 text-destructive">
              {listError}
            </p>
          ) : null}

          {segments !== null ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SegmentList title="我在里面" testId="live-member-list" items={segments.member} />
              <SegmentList title="我管着它" testId="live-managed-list" items={segments.managed} />
            </div>
          ) : (
            <p data-testid="live-list-empty-state" className="text-12 text-muted-foreground">
              还没有加载列表——填组织 id 后点「刷新列表」。
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>新建项目</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-2" onSubmit={handleCreate}>
                <Input
                  data-testid="live-create-name"
                  placeholder="项目名"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <select
                  data-testid="live-create-kind"
                  className="h-8 rounded-md border border-input bg-card px-2.5 text-13"
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as (typeof PROJECT_KIND_OPTIONS)[number])}
                >
                  {PROJECT_KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <Button data-testid="live-create-submit" type="submit" disabled={createBusy || orgId === ""}>
                  {createBusy ? "创建中…" : "创建"}
                </Button>
                {createError !== null ? (
                  <p data-testid="live-create-error" className="text-12 text-destructive">
                    {createError}
                  </p>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SegmentList({ title, testId, items }: { title: string; testId: string; items: ProjectListItem[] }) {
  return (
    <div>
      <h2 className="mb-1 text-13 font-medium text-muted-foreground">{title}</h2>
      {items.length === 0 ? (
        <p data-testid={`${testId}-empty`} className="text-12 text-muted-foreground">
          空列表
        </p>
      ) : (
        <ul data-testid={testId} className="flex flex-col gap-1">
          {items.map((it) => (
            <ProjectRow key={it.id} item={it} />
          ))}
        </ul>
      )}
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
