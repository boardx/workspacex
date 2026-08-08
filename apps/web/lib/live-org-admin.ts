/**
 * issue #355 —— org-admin 束的真实 API 薄封装，跟 `live-projects.ts` 同一个模式：
 * 类型全部从 `@repo/contracts` 推导，调用一律走 `apiRequest`。
 *
 * ## 只封装了后端真正有 controller 的四个操作
 *
 * 读 `apps/api/src/interface/controllers/org-admin-management.controller.ts` +
 * `org-invite.controller.ts` + `apps/api/src/application/auth/org-member-ports.ts` +
 * `org-invite-ports.ts` 确认过：后端目前**没有任何 GET 列表端点**——
 * `OrgMemberRepository` 只有 `remove()`，`OrgInviteRepository` 只有
 * `create()` / `activate()` / `reviewAdminInvite()`。没有 `list()`。
 * 契约里 `resendOrgInvite` / `revokeOrgInvite` 两个操作**存在但没有对应 controller
 * 路由**（`grep -rn "resendOrgInvite\|revokeOrgInvite" interface/controllers/` 命中为空）。
 *
 * 所以这里只封装四个确实能打通的写操作：
 *   - `inviteOrgMember`   邀请成员进组织
 *   - `reviewAdminInvite` 双人复核批准/拒绝管理员邀请
 *   - `removeOrgMember`   移除组织成员
 *   - `mutateTeam`        团队增/删/改
 *
 * 成员名单 / 邀请名单本身**没有真实数据源可读**，仍然只能来自
 * `lib/mock/admin.ts` 与 `lib/mock/org-admin.ts`——这不是没做，是后端还没有对应的
 * 读端点（见 PR 描述里的 gap 记录）。
 *
 * #639 delta 迭代 1：`listTeams` 补上——`GET /organizations/:orgId/teams` 现在有真
 * controller 了（`org-admin-management.controller.ts`），是本文件第一个真实的**读**操作。
 * 团队 CRUD 动作（create/rename/delete）迭代 2 再接前端，这里只加 `listTeams`。
 */
import { identity, orgAdmin } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type InviteOrgMemberOut = z.infer<typeof orgAdmin.operations.inviteOrgMember.out>;
export type ReviewAdminInviteOut = z.infer<typeof orgAdmin.operations.reviewAdminInvite.out>;
export type RemoveOrgMemberOut = z.infer<typeof orgAdmin.operations.removeOrgMember.out>;
export type MutateTeamOut = z.infer<typeof orgAdmin.operations.mutateTeam.out>;

function path(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(`:${k}`, encodeURIComponent(v)),
    template,
  );
}

export interface InviteOrgMemberInput {
  readonly orgId: string;
  readonly email: string;
  readonly orgRole: z.infer<typeof identity.OrgRole>;
  readonly teamId: string;
}

export async function inviteOrgMember(input: InviteOrgMemberInput): Promise<InviteOrgMemberOut> {
  return apiRequest<InviteOrgMemberOut>(
    path(orgAdmin.operations.inviteOrgMember.path, { orgId: input.orgId }),
    { method: "POST", body: { orgId: input.orgId, email: input.email, orgRole: input.orgRole, teamId: input.teamId } },
  );
}

export interface ReviewAdminInviteInput {
  readonly orgId: string;
  readonly inviteId: string;
  readonly decision: "approve" | "reject";
  readonly reason: string | null;
}

export async function reviewAdminInvite(input: ReviewAdminInviteInput): Promise<ReviewAdminInviteOut> {
  return apiRequest<ReviewAdminInviteOut>(
    path(orgAdmin.operations.reviewAdminInvite.path, { orgId: input.orgId, inviteId: input.inviteId }),
    {
      method: "POST",
      body: { orgId: input.orgId, inviteId: input.inviteId, decision: input.decision, reason: input.reason },
    },
  );
}

export interface RemoveOrgMemberInput {
  readonly orgId: string;
  readonly userId: string;
}

export async function removeOrgMember(input: RemoveOrgMemberInput): Promise<RemoveOrgMemberOut> {
  return apiRequest<RemoveOrgMemberOut>(
    path(orgAdmin.operations.removeOrgMember.path, { orgId: input.orgId, userId: input.userId }),
    { method: "POST", body: { orgId: input.orgId, userId: input.userId } },
  );
}

export interface MutateTeamInput {
  readonly orgId: string;
  readonly op: z.infer<typeof orgAdmin.TeamOp>;
  readonly teamId: string | null;
  readonly name: string | null;
}

export async function mutateTeam(input: MutateTeamInput): Promise<MutateTeamOut> {
  return apiRequest<MutateTeamOut>(path(orgAdmin.operations.mutateTeam.path, { orgId: input.orgId }), {
    method: "POST",
    body: { orgId: input.orgId, op: input.op, teamId: input.teamId, name: input.name },
  });
}

export type ListTeamsOut = z.infer<typeof orgAdmin.operations.listTeams.out>;

export async function listTeams(orgId: string): Promise<ListTeamsOut> {
  return apiRequest<ListTeamsOut>(path(orgAdmin.operations.listTeams.path, { orgId }), { method: "GET" });
}
