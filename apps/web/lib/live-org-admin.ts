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
 * （历史注，已过时：`resendOrgInvite` / `revokeOrgInvite` 当时没有 controller 路由；
 * #363 已把两条接上——`org-admin-management.controller.ts` 的 resend / revoke——
 * #638 迭代 5 在本文件末尾补齐对应封装。）
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

/* ─────────────────────────── team-crud delta，迭代 2 ─────────────────────────── */

export type CreateTeamOut = z.infer<typeof orgAdmin.operations.createTeam.out>;
export type RenameTeamOut = z.infer<typeof orgAdmin.operations.renameTeam.out>;
export type DeleteTeamOut = z.infer<typeof orgAdmin.operations.deleteTeam.out>;

/** `POST .../teams/create`——与 `mutateTeam` 是不同的路由，见 `org-admin.ts` `createTeam` 的文档注释。 */
export async function createTeam(orgId: string, name: string): Promise<CreateTeamOut> {
  return apiRequest<CreateTeamOut>(path(orgAdmin.operations.createTeam.path, { orgId }), {
    method: "POST",
    body: { name },
  });
}

export async function renameTeam(orgId: string, teamId: string, name: string): Promise<RenameTeamOut> {
  return apiRequest<RenameTeamOut>(
    path(orgAdmin.operations.renameTeam.path, { orgId, teamId }),
    { method: "PATCH", body: { name } },
  );
}

/** ⚠ 路由是 `POST .../delete`，不是 `DELETE`——见 `deleteTeam` 契约操作的文档注释。 */
export async function deleteTeam(orgId: string, teamId: string): Promise<DeleteTeamOut> {
  return apiRequest<DeleteTeamOut>(
    path(orgAdmin.operations.deleteTeam.path, { orgId, teamId }),
    { method: "POST", body: {} },
  );
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
/**
 * 2026-08-11 devapp 实测：上传请求在生产可能永远不返回（服务端/链路挂起），按钮就永远
 * 停在「上传中…」。给这一发 fetch 一个硬超时——5MB 上限的体在还活着的连接上 60s
 * 绰绰有余；超时抛 `TimeoutError`，由 org-admin-screen.tsx 显示「上传超时，请重试」。
 * 永远不该让用户卡在没有反馈的等待里。
 */
export const UPLOAD_ORG_AVATAR_TIMEOUT_MS = 60_000;

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

  const res = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    body: bytes,
    signal: AbortSignal.timeout(UPLOAD_ORG_AVATAR_TIMEOUT_MS),
  });
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

/* ═══════════════════ #638 迭代 5：邀请的重发 / 撤销 ═══════════════════ */

export type ResendOrgInviteOut = z.infer<typeof orgAdmin.operations.resendOrgInvite.out>;
export type RevokeOrgInviteOut = z.infer<typeof orgAdmin.operations.revokeOrgInvite.out>;

/**
 * `POST /organizations/:orgId/invites/:inviteId/resend`——重发 = 签发新令牌 + 作废旧令牌
 * （I-6），不幂等，受 `AUTH_POLICY.resendCooldownSeconds` / `resendDailyMax` 限流
 * （`RATE_LIMITED`）。可重发状态只有 `pending` / `send-failed`（后端
 * `pg-org-invite-repository.ts` `resendOne` 的状态门）。
 */
export async function resendOrgInvite(orgId: string, inviteId: string): Promise<ResendOrgInviteOut> {
  return apiRequest<ResendOrgInviteOut>(
    path(orgAdmin.operations.resendOrgInvite.path, { orgId, inviteId }),
    { method: "POST", body: { orgId, inviteId } },
  );
}

/** `POST /organizations/:orgId/invites/:inviteId/revoke`——幂等；`used` 的邀请撤不了（`VERSION_CHANGED`）。 */
export async function revokeOrgInvite(orgId: string, inviteId: string): Promise<RevokeOrgInviteOut> {
  return apiRequest<RevokeOrgInviteOut>(
    path(orgAdmin.operations.revokeOrgInvite.path, { orgId, inviteId }),
    { method: "POST", body: { orgId, inviteId } },
  );
}

/* ═══════════════ F160：成员 token 配额（token-quota-and-usage delta）═══════════════
 *
 * ⚠ 三条都**仅组织 admin**（后端 `requireOrgAdmin`）。与本文件里 `listOrgMembers`
 *   那条对普通成员开放的读**不是同一个授权面**——额度是钱。
 *
 * ⚠ `orgBudget` / `unallocated` / `monthlyLimit` 可空，且 **null ≠ 0**：
 *   null 是「还没设过 / 还没分配」，0 是「设了 0」。渲染时不要 `?? 0`，
 *   那会把「未设置」显示成「已用尽」。
 */

export type GetTokenQuotasOut = z.infer<typeof orgAdmin.operations.getTokenQuotas.out>;
export type SetMemberTokenQuotaOut = z.infer<typeof orgAdmin.operations.setMemberTokenQuota.out>;
export type SetOrgTokenBudgetOut = z.infer<typeof orgAdmin.operations.setOrgTokenBudget.out>;

/** `GET /organizations/:orgId/token-quotas`——「成员配额」tab 整屏的数据来源。 */
export async function getTokenQuotas(orgId: string): Promise<GetTokenQuotasOut> {
  return apiRequest<GetTokenQuotasOut>(
    path(orgAdmin.operations.getTokenQuotas.path, { orgId }),
    { method: "GET" },
  );
}

/**
 * `PATCH /organizations/:orgId/token-quotas/:userId`——成员行 `[调整]` 的落点。
 * 超过组织额度时抛 `ApiError`，`reasonCode = QUOTA_OVERALLOCATED`，响应体带
 * `remainingTokens`（还剩多少可分）——界面必须把那个数说出来，只说「超了」
 * 等于让管理员靠试。
 */
export async function setMemberTokenQuota(
  orgId: string, userId: string, monthlyLimit: number,
): Promise<SetMemberTokenQuotaOut> {
  return apiRequest<SetMemberTokenQuotaOut>(
    path(orgAdmin.operations.setMemberTokenQuota.path, { orgId, userId }),
    { method: "PATCH", body: { orgId, userId, monthlyLimit } },
  );
}

/** `PATCH /organizations/:orgId/token-budget`——设置组织月度额度；调到低于已分配之和会被拒。 */
export async function setOrgTokenBudget(
  orgId: string, monthlyBudget: number,
): Promise<SetOrgTokenBudgetOut> {
  return apiRequest<SetOrgTokenBudgetOut>(
    path(orgAdmin.operations.setOrgTokenBudget.path, { orgId }),
    { method: "PATCH", body: { orgId, monthlyBudget } },
  );
}

/* ═══════════════ F161：用量监控（token-quota-and-usage delta）═══════════════ */

export type UsageWindowKey = z.infer<typeof orgAdmin.UsageStatWindow>;
export type GetUsageReportOut = z.infer<typeof orgAdmin.operations.getUsageReport.out>;

/**
 * `GET /organizations/:orgId/usage?window=…`
 *
 * ⚠ 窗口是**请求参数**，不是本地筛选：换窗口必须发一次新请求。此前那份 mock 的
 * 文件头逐字写着「窗口切换只影响本地展示态」——那正是 F161 要消灭的东西。
 */
export async function getUsageReport(
  orgId: string, window: UsageWindowKey,
): Promise<GetUsageReportOut> {
  return apiRequest<GetUsageReportOut>(
    `${path(orgAdmin.operations.getUsageReport.path, { orgId })}?window=${encodeURIComponent(window)}`,
    { method: "GET" },
  );
}

/* ═══════════════ F162：限额策略（token-quota-and-usage delta §1.4）═══════════════ */

export type ListLimitRulesOut = z.infer<typeof orgAdmin.operations.listLimitRules.out>;
export type ListLimitEventsOut = z.infer<typeof orgAdmin.operations.listLimitEvents.out>;
export type LimitScopeKind = z.infer<typeof orgAdmin.LimitScopeKind>;
export type LimitWindowKind = z.infer<typeof orgAdmin.LimitWindowKind>;
export type LimitAction = z.infer<typeof orgAdmin.LimitAction>;

export async function listLimitRules(orgId: string): Promise<ListLimitRulesOut> {
  return apiRequest<ListLimitRulesOut>(
    path(orgAdmin.operations.listLimitRules.path, { orgId }), { method: "GET" });
}

/** ⚠ `action: "degrade"` 必须带 `degradeToModelId`，否则 400 `DEGRADE_TARGET_REQUIRED`——
 *  「降级」而不说降到哪等于运行时静默换模型（I-28 的反面）。 */
export async function createLimitRule(
  orgId: string,
  input: Omit<z.infer<typeof orgAdmin.operations.createLimitRule.in>, "orgId">,
): Promise<{ ruleId: string }> {
  return apiRequest(path(orgAdmin.operations.createLimitRule.path, { orgId }), {
    method: "POST", body: { orgId, ...input },
  });
}

export async function updateLimitRule(
  orgId: string, ruleId: string,
  input: Omit<z.infer<typeof orgAdmin.operations.updateLimitRule.in>, "orgId" | "ruleId">,
): Promise<{ ruleId: string }> {
  return apiRequest(path(orgAdmin.operations.updateLimitRule.path, { orgId, ruleId }), {
    method: "PATCH", body: { orgId, ruleId, ...input },
  });
}

export async function deleteLimitRule(orgId: string, ruleId: string): Promise<{ ruleId: string }> {
  return apiRequest(path(orgAdmin.operations.deleteLimitRule.path, { orgId, ruleId }), {
    method: "POST", body: { orgId, ruleId },
  });
}

export async function listLimitEvents(orgId: string): Promise<ListLimitEventsOut> {
  return apiRequest<ListLimitEventsOut>(
    path(orgAdmin.operations.listLimitEvents.path, { orgId }), { method: "GET" });
}
