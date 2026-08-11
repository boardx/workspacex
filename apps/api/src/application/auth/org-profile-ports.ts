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
  /**
   * 邀请人的真实姓名（`credentials.display_name`），不是裸 user id——
   * 契约字段仍叫 `invitedBy: string`（不新增字段，最小侵入），但值经过 join。
   * 兜底：邀请人账号在 `credentials` 里查不到时（无级联删除保证）退回裸 id，
   * 好过整行从列表消失。
   */
  readonly invitedBy: string;
  /**
   * 邀请人的裸 user id（invite-link-and-reads delta ②）。上面那条「不新增字段」的
   * 旧注释自 coord-main 2026-08-11 裁决起不再成立：前端要判「当前用户是不是发起人」
   * 来消灭发起人视角的「批准」死按钮（I-4 自批必 403），展示名做不了这个判定。
   */
  readonly invitedByUserId: string;
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
