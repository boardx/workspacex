/**
 * `OrgProfileRepository` —— org-profile-membership delta（#363）的唯一持久化端口。
 *
 * 四个操作共用一个端口而不是四个：都是对同一张 `organizations` + 其关联表
 * （`org_memberships`/`org_invites`/`org_avatar_artifacts`）的读写，拆成四个端口
 * 只会把「同一把 orgId 租户锁」的拼装重复四次（`team-ports.ts` 头注同一条理由）。
 */
import type { OrgId } from "../../domain/org-id";

export interface OrgMemberListRow {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly orgRole: string;
  readonly teamId: string | null;
  readonly joinedAt: string;
  /** 恒为 `"active"`——`org_memberships` 目前没有「停用但保留记录」的概念（OA11 ③）。 */
  readonly status: "active" | "suspended";
}

export interface OrgInviteListRow {
  readonly inviteId: string;
  readonly email: string;
  readonly status: string;
  readonly invitedBy: string;
  readonly expiresAt: string;
}

export interface OrgProfile {
  readonly name: string;
  readonly description: string | null;
  readonly avatarArtifactId: string | null;
  readonly avatarUrl: string | null;
}

export interface UpdateOrganizationInput {
  readonly name?: string;
  readonly description?: string;
  /** undefined = 不改；null = 清空头像；非 null = 换成这个 artifact。 */
  readonly avatarArtifactId?: string | null;
}

export type UpdateOrganizationResult =
  | { readonly ok: true; readonly profile: OrgProfile }
  /** `avatarArtifactId` 不属于这个组织（不存在，或属于别的组织）。 */
  | { readonly ok: false; readonly reason: "avatar-not-owned" };

export interface StoredOrgAvatar {
  readonly orgAvatarArtifactId: string;
  readonly avatarUrl: string;
}

export interface OrgProfileRepository {
  listMembers(orgId: OrgId): Promise<readonly OrgMemberListRow[]>;
  listInvites(orgId: OrgId): Promise<readonly OrgInviteListRow[]>;
  updateOrganization(orgId: OrgId, input: UpdateOrganizationInput): Promise<UpdateOrganizationResult>;
  /**
   * 落对象存储 + `org_avatar_artifacts` 归属登记（第一步，见契约 `uploadOrgAvatar` 文件头
   * 的两步形状说明）。调用方已经完成 magic-byte 校验——这里只管落库落存储。
   */
  storeAvatar(
    orgId: OrgId,
    actorId: string,
    bytes: Uint8Array,
    contentType: "image/png" | "image/jpeg" | "image/webp",
    sha256: string,
  ): Promise<StoredOrgAvatar>;
  /** 读回头像字节，供 `GET /organizations/:orgId/avatar-file/:artifactId` 使用。 */
  readAvatarBytes(orgId: OrgId, avatarArtifactId: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

export const ORG_PROFILE_REPOSITORY = Symbol("OrgProfileRepository");
