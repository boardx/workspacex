/**
 * `PlatformAdminRepository` -- 落库的"平台管理员"名册（platform-admin-role delta）唯一端口。
 * 与 `PlatformMemberRepository`（只读名册聚合）分开：这个端口是本 delta 唯一的**写**面，
 * 且写的内容只有"谁被授予了这个角色"，不涉及组织成员身份本身。
 */
export interface PlatformAdminRepository {
  isPlatformAdmin(userId: string): Promise<boolean>;
  /** 批量判定用：`listPlatformMembers` 给名册的每一行打标记时，不想为每一行单独查一次。 */
  listAdminUserIds(): Promise<ReadonlySet<string>>;
  /** 幂等：已经是的再授一次不报错、不产生第二行。 */
  grant(userId: string, grantedBy: string): Promise<void>;
  /** 幂等：本来就不是的再撤一次不报错。 */
  revoke(userId: string): Promise<void>;
}

export const PLATFORM_ADMIN_REPOSITORY = Symbol("PlatformAdminRepository");
