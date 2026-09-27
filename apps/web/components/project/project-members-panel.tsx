"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "./parts";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES } from "@/lib/identity";
import { useOptionalSession } from "@/components/session/session-provider";
import { listOrgMembers } from "@/lib/live-org-admin";
import {
  listProjectMembers, addProjectMember, changeProjectRole, removeProjectMember,
  type ProjectMemberEntry, type ProjectMemberRole,
} from "@/lib/live-project-members";

/**
 * 「项目成员」面板（项目中枢 R3）——项目是权限容器：谁在里面、什么角色，在这里看和改。
 *
 * 读：`listProjectMembers`（所有非观察者视角可读；非工作坊两类返回 `members: null`，如实说明）。
 * 写（`canManage`）：从组织成员里直接指派（`addProjectMember` orgUser）、改角色、移出。
 *   服务端判定 `authorizeManageMembers`：本项目引导师，或组织 `lead` / `admin`；越权 403 如实显示。
 * 每次写成功后**重新拉一次列表**，不在本地 append / patch（本仓一贯纪律）。
 */
export function ProjectMembersPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const session = useOptionalSession();
  const orgId = session?.session?.currentOrgId ?? null;

  const [members, setMembers] = React.useState<ProjectMemberEntry[] | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [orgRoster, setOrgRoster] = React.useState<Array<{ userId: string; displayName: string }>>([]);
  const [pickUser, setPickUser] = React.useState<string>("");
  const [pickRole, setPickRole] = React.useState<ProjectMemberRole>("member");
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoadError(null);
    try {
      const out = await listProjectMembers(projectId);
      setMembers(out.members);
    } catch (e) {
      setLoadError(describeFailure(e));
      setMembers(undefined);
    }
  }, [projectId]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  React.useEffect(() => {
    if (!canManage || !orgId) return;
    let cancelled = false;
    listOrgMembers(orgId)
      .then((out) => { if (!cancelled) setOrgRoster(out.members.map((m) => ({ userId: m.userId, displayName: m.displayName }))); })
      .catch(() => { if (!cancelled) setOrgRoster([]); });
    return () => { cancelled = true; };
  }, [canManage, orgId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setActionError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setActionError(describeFailure(e));
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set((members ?? []).map((m) => m.userId));
  const candidates = orgRoster.filter((m) => !memberIds.has(m.userId));

  return (
    <section data-testid="project-members-panel">
      <SectionTitle meta="项目是权限容器：只有名单上的人能看到项目内容">项目成员</SectionTitle>
      <Card>
        {loadError !== null ? (
          <p className="p-4 text-11 text-destructive" data-testid="project-members-error">{loadError}</p>
        ) : members === undefined ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-members-loading">读取成员中…</p>
        ) : members === null ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-members-null">
            这类容器（研究项目 / 用户洞察）只有拥有者与协作者两档，成员操作尚未建模。
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="project-members-list">
            {members.length === 0 && (
              <li className="px-3.5 py-3 text-11 text-muted-foreground" data-testid="project-members-empty">还没有成员。</li>
            )}
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-3.5 py-2.5" data-testid={`project-member-${m.userId}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-12">{m.displayName}</div>
                  <div className="font-mono text-10 text-muted-foreground">{m.userId}</div>
                </div>
                {m.isHost && <Badge tone="primary">主持</Badge>}
                {canManage ? (
                  <Select
                    data-testid={`project-member-role-${m.userId}`}
                    value={m.projectRole}
                    disabled={busy}
                    onValueChange={(v) => void run(() => changeProjectRole({ projectId, userId: m.userId, projectRole: v as ProjectMemberRole, isHost: m.isHost }))}
                    options={PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE_LABEL[r] }))}
                    className="min-w-[8rem]"
                  />
                ) : (
                  <Badge tone="outline">{PROJECT_ROLE_LABEL[m.projectRole]}</Badge>
                )}
                {canManage && (
                  <Button size="xs" variant="ghost" disabled={busy} data-testid={`project-member-remove-${m.userId}`}
                    onClick={() => void run(() => removeProjectMember(projectId, m.userId))}>
                    移出
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && members !== null && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-3" data-testid="project-members-add">
            <label className="flex flex-col gap-1 text-10 text-muted-foreground">
              <span>从组织成员里指派</span>
              <Select
                data-testid="project-members-add-user"
                value={pickUser}
                onValueChange={setPickUser}
                placeholder={candidates.length === 0 ? "组织里没有可指派的人" : "选择成员…"}
                disabled={busy || candidates.length === 0}
                options={candidates.map((c) => ({ value: c.userId, label: c.displayName }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-10 text-muted-foreground">
              <span>角色</span>
              <Select
                data-testid="project-members-add-role"
                value={pickRole}
                onValueChange={(v) => setPickRole(v as ProjectMemberRole)}
                options={PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE_LABEL[r] }))}
                className="min-w-[8rem]"
              />
            </label>
            <Button size="sm" variant="primary" disabled={busy || pickUser === ""} data-testid="project-members-add-submit"
              onClick={() => void run(async () => { await addProjectMember({ projectId, userId: pickUser, projectRole: pickRole }); setPickUser(""); })}>
              加入项目
            </Button>
          </div>
        )}
        {actionError !== null && (
          <p className="border-t border-border px-3.5 py-2 text-11 text-destructive" data-testid="project-members-action-error">{actionError}</p>
        )}
      </Card>
    </section>
  );
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE": return "你不在这个项目里，看不到成员名单。";
      case "PROJECT_ROLE_INSUFFICIENT": return "只有本项目的引导师（或组织负责人 / 管理员）能管理成员。";
      case "ORG_ROLE_INSUFFICIENT": return "你的组织角色不足以管理这个项目的成员。";
      case "PROJECT_ARCHIVED": return "项目已归档，成员名单只读。";
      case "AUTH_SERVICE_UNAVAILABLE": return "身份校验服务暂时不可用，请稍后重试。";
    }
    if (e.status === 400) return "这个人已经在项目里了。";
    if (e.status === 401) return "登录已失效，请重新登录。";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "操作失败，请稍后重试。";
}
