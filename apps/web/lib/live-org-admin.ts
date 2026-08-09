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
 *
 * #363 收拢（org-profile-membership delta）：补 `listOrgMembers` / `listOrgInvites` /
 * `updateOrganization` / `uploadOrgAvatar` 四个真实操作——`listOrgMembers`/`listOrgInvites`
 * 是这份文件第一次读到「成员是谁」「邀请到哪了」的真实数据，此前只有 mock。
 *
 * `uploadOrgAvatar` 不走 `apiRequest`（它假设 JSON body）：契约的 `in` 只有声明的元数据
 * （见 `org-admin.ts` 里 `uploadOrgAvatar` 的文件头注释），图片字节走请求的原始二进制体，
 * 元数据经查询串传入，所以这里手写一次 `fetch`，复用 `apiUrl`/`getStoredSessionToken`。
 */
import { identity, orgAdmin } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, apiUrl, ApiError, extractReasonCode, getStoredSessionToken } from "./api-client";

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

/* ═══════════════════ #363 收拢：成员/邀请列表读 + 组织资料编辑 ═══════════════════ */

export type ListOrgMembersOut = z.infer<typeof orgAdmin.operations.listOrgMembers.out>;

/** 任何组织成员可读（delta §2）。`GET /organizations/:orgId/members`。 */
export async function listOrgMembers(orgId: string): Promise<ListOrgMembersOut> {
  return apiRequest<ListOrgMembersOut>(path(orgAdmin.operations.listOrgMembers.path, { orgId }), { method: "GET" });
}

export type ListOrgInvitesOut = z.infer<typeof orgAdmin.operations.listOrgInvites.out>;

/** 仅组织 admin 可读（delta §2，权限比 listOrgMembers 更紧）。`GET /organizations/:orgId/invites`。 */
export async function listOrgInvites(orgId: string): Promise<ListOrgInvitesOut> {
  return apiRequest<ListOrgInvitesOut>(path(orgAdmin.operations.listOrgInvites.path, { orgId }), { method: "GET" });
}

export type UpdateOrganizationOut = z.infer<typeof orgAdmin.operations.updateOrganization.out>;

export interface UpdateOrganizationInput {
  readonly orgId: string;
  readonly name?: string;
  readonly description?: string;
  readonly avatarArtifactId?: string | null;
}

/** 仅组织 admin（delta §2）。`PATCH /organizations/:orgId`。 */
export async function updateOrganization(input: UpdateOrganizationInput): Promise<UpdateOrganizationOut> {
  return apiRequest<UpdateOrganizationOut>(path(orgAdmin.operations.updateOrganization.path, { orgId: input.orgId }), {
    method: "PATCH",
    body: {
      orgId: input.orgId,
      name: input.name,
      description: input.description,
      avatarArtifactId: input.avatarArtifactId,
    },
  });
}

export type UploadOrgAvatarOut = z.infer<typeof orgAdmin.operations.uploadOrgAvatar.out>;

export interface UploadOrgAvatarInput {
  readonly orgId: string;
  readonly file: File;
}

/**
 * 仅组织 admin（delta §2）。`POST /organizations/:orgId/avatar`——契约的 `in` 只有
 * 声明的元数据（filename/sizeBytes/sha256/contentType），走查询串；图片字节是这次
 * POST 的原始请求体。服务端会重新做 magic-byte 嗅探，不信任这里声明的 `contentType`
 * （见 `apps/api/src/application/auth/upload-org-avatar.ts`）——这里声明的值只是
 *「客户端认为是什么」，被拒绝时错误码来自服务端的真实校验。
 */
export async function uploadOrgAvatar(input: UploadOrgAvatarInput): Promise<UploadOrgAvatarOut> {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const contentType = input.file.type;

  const url = apiUrl(path(orgAdmin.operations.uploadOrgAvatar.path, { orgId: input.orgId }), {
    filename: input.file.name,
    sizeBytes: String(bytes.byteLength),
    sha256,
    contentType,
  });

  const token = getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers["Content-Type"] = contentType;

  const res = await fetch(url, { method: "POST", headers, credentials: "include", body: bytes });
  const text = await res.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, extractReasonCode(json), json);
  return json as UploadOrgAvatarOut;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `crypto.subtle.digest` 的 TS lib 类型要求 `ArrayBuffer`-backed view，而
  // `input.file.arrayBuffer()` 返回的 `Uint8Array` 在某些 lib 版本下推成
  // `ArrayBufferLike`（含 `SharedArrayBuffer`）。拷贝一份新 `Uint8Array` 即可满足类型，
  // 运行时行为不变（`bytes` 本来就不是共享内存）。
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
