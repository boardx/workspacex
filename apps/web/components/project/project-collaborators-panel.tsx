"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "./parts";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { useOptionalSession } from "@/components/session/session-provider";
import { listOrgMembers } from "@/lib/live-org-admin";
import {
  listNonWorkshopMembers, addNonWorkshopMember, removeNonWorkshopMember,
  NON_WORKSHOP_MEMBER_ROLE_LABEL, NON_WORKSHOP_MEMBER_ROLES,
  type NonWorkshopMemberEntry, type NonWorkshopMemberRole,
} from "@/lib/live-project-collaborators";

/**
 * 「协作者」面板（项目中枢 B3-T5，#4499）——研究项目 / 用户洞察两类容器的名单，两档
 * 负责人 / 协作者。与工作坊的 `ProjectMembersPanel` 同一套骨架（Card + 行 + 指派条），
 * 但走 `/collaborators` 三条契约，不共用类型：两档不是四角色。
 *
 * 读：`listNonWorkshopMembers`（名单上的人与组织 lead/admin 可读）。
 * 写（负责人）：从组织成员里指派（再指派同一人 = 改档）、移出。
 *   控件只在**自己是负责人**、或**名单里还没有负责人**（组织 lead/admin 可加第一位）时给；
 *   服务端 `decideNonWorkshopMemberAccess` 才是判定，403 如实显示。
 * 每次写成功后**重新拉一次列表**，不在本地 append / patch（本仓一贯纪律）。
 */
export function ProjectCollaboratorsPanel({ projectId }: { projectId: string }) {
  const session = useOptionalSession();
  const orgId = session?.session?.currentOrgId ?? null;
  const me = session?.session?.userId ?? null;

  const [members, setMembers] = React.useState<NonWorkshopMemberEntry[] | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [orgRoster, setOrgRoster] = React.useState<Array<{ userId: string; displayName: string }>>([]);
  const [pickUser, setPickUser] = React.useState<string>("");
  const [pickRole, setPickRole] = React.useState<NonWorkshopMemberRole>("collaborator");
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoadError(null);
    try {
      const out = await listNonWorkshopMembers(projectId);
      setMembers(out.members);
    } catch (e) {
      setLoadError(describeFailure(e));
      setMembers(undefined);
    }
  }, [projectId]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const hasOwner = (members ?? []).some((m) => m.role === "owner");
  const iAmOwner = me !== null && (members ?? []).some((m) => m.userId === me && m.role === "owner");
  const canManage = members !== undefined && (iAmOwner || !hasOwner);

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
  const roleOptions = NON_WORKSHOP_MEMBER_ROLES.map((r) => ({ value: r, label: NON_WORKSHOP_MEMBER_ROLE_LABEL[r] }));

  return (
    <section data-testid="project-collaborators-panel">
      <SectionTitle meta="研究项目 / 用户洞察只有负责人与协作者两档；只有名单上的人能看到内容">协作者</SectionTitle>
      <Card>
        {loadError !== null ? (
          <p className="p-4 text-11 text-destructive" data-testid="project-collaborators-error">{loadError}</p>
        ) : members === undefined ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-collaborators-loading">读取协作者中…</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="project-collaborators-list">
            {members.length === 0 && (
              <li className="px-3.5 py-3 text-11 text-muted-foreground" data-testid="project-collaborators-empty">
                还没有人。组织负责人 / 管理员可以指派第一位负责人。
              </li>
            )}
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-3.5 py-2.5" data-testid={`project-collaborator-${m.userId}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-12">{m.displayName}</div>
                  <div className="font-mono text-10 text-muted-foreground">{m.userId}</div>
                </div>
                {canManage ? (
                  <Select
                    data-testid={`project-collaborator-role-${m.userId}`}
                    value={m.role}
                    disabled={busy}
                    onValueChange={(v) => void run(() => addNonWorkshopMember({ projectId, userId: m.userId, role: v as NonWorkshopMemberRole }))}
                    options={roleOptions}
                    className="min-w-[8rem]"
                  />
                ) : (
                  <Badge tone={m.role === "owner" ? "primary" : "outline"}>{NON_WORKSHOP_MEMBER_ROLE_LABEL[m.role]}</Badge>
                )}
                {canManage && (
                  <Button size="xs" variant="ghost" disabled={busy} data-testid={`project-collaborator-remove-${m.userId}`}
                    onClick={() => void run(() => removeNonWorkshopMember(projectId, m.userId))}>
                    移出
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-3" data-testid="project-collaborators-add">
            <label className="flex flex-col gap-1 text-10 text-muted-foreground">
              <span>从组织成员里指派</span>
              <Select
                data-testid="project-collaborators-add-user"
                value={pickUser}
                onValueChange={setPickUser}
                placeholder={candidates.length === 0 ? "组织里没有可指派的人" : "选择成员…"}
                disabled={busy || candidates.length === 0}
                options={candidates.map((c) => ({ value: c.userId, label: c.displayName }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-10 text-muted-foreground">
              <span>档位</span>
              <Select
                data-testid="project-collaborators-add-role"
                value={pickRole}
                onValueChange={(v) => setPickRole(v as NonWorkshopMemberRole)}
                options={roleOptions}
                className="min-w-[8rem]"
              />
            </label>
            <Button size="sm" variant="primary" disabled={busy || pickUser === ""} data-testid="project-collaborators-add-submit"
              onClick={() => void run(async () => { await addNonWorkshopMember({ projectId, userId: pickUser, role: pickRole }); setPickUser(""); })}>
              加入
            </Button>
          </div>
        )}
        {actionError !== null && (
          <p className="border-t border-border px-3.5 py-2 text-11 text-destructive" data-testid="project-collaborators-action-error">{actionError}</p>
        )}
      </Card>
    </section>
  );
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE": return "你不在这个容器的名单上，看不到协作者。";
      case "PROJECT_ROLE_INSUFFICIENT": return "只有负责人能指派或移出协作者。";
      case "ORG_ROLE_INSUFFICIENT": return "你不是这个容器的负责人；名单为空时只有组织负责人 / 管理员能指派第一位。";
      case "PROJECT_ARCHIVED": return "容器已归档，协作者名单只读。";
      case "AUTH_SERVICE_UNAVAILABLE": return "身份校验服务暂时不可用，请稍后重试。";
    }
    if (e.status === 400) return "这个容器不支持协作者名单（工作坊请用项目成员）。";
    if (e.status === 401) return "登录已失效，请重新登录。";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "操作失败，请稍后重试。";
}
