"use client";

import * as React from "react";
import { Plus, Settings, Users } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import { listTeams, type ListTeamsOut } from "@/lib/live-org-admin";

/**
 * `/org-admin` —— 组织管理页（#639 delta，迭代 1）。
 *
 * ## 本轮范围
 * 只有"团队"一个标签页，且只做**列表**。创建/改名/删除三个动作按钮渲染为禁用态
 * （`title` 说明"下一轮开放"），不是漏做了交互——后端 `mutateTeam` controller 早就
 * 存在，前端本轮刻意不接，避免范围扩大。
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

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-11 text-muted-foreground">组织内的团队。创建 / 改名 / 删除下一轮迭代开放。</p>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled
          data-testid="org-admin-create-team"
          aria-disabled="true"
          title="创建团队下一轮开放"
        >
          <Plus aria-hidden className="h-3 w-3" />
          新建团队
        </Button>
      </div>

      <StateShell
        state={state}
        emptyHint="这个组织还没有任何团队。"
        depFailure={{ what: failureMessage ?? "团队列表服务暂时不可用", retry: load }}
      >
        <ul className="flex flex-col gap-1.5" data-testid="org-admin-team-list">
          {out?.teams.map((team) => (
            <li
              key={team.teamId}
              data-testid={`org-admin-team-${team.teamId}`}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-13 font-medium">{team.name}</span>
                <span className="text-10 text-muted-foreground" data-testid={`org-admin-team-${team.teamId}-member-count`}>
                  {team.memberCount} 名成员
                </span>
              </div>
              <div className="flex gap-1.5">
                <Button type="button" size="xs" variant="ghost" disabled aria-disabled="true" title="改名下一轮开放" data-testid={`org-admin-team-${team.teamId}-rename`}>
                  改名
                </Button>
                <Button type="button" size="xs" variant="ghost" disabled aria-disabled="true" title="删除下一轮开放" data-testid={`org-admin-team-${team.teamId}-delete`}>
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </StateShell>
    </div>
  );
}

function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 403) return "当前身份无权读取团队列表（HTTP 403）。";
    if (failure.status === 404) return "组织不存在或当前身份不可见（HTTP 404）。";
    return `${failure.reasonCode ?? "加载失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "加载失败，请稍后重试。";
}
