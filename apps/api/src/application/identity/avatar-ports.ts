/**
 * `AvatarRepository` —— `user_avatars` 的唯一持久化端口（#638 delta，迭代 2）。
 *
 * 与 `CredentialRepository` 分开而不是塞进它：`user_avatars` 是"哪些字节曾经被上传过、
 * 属于谁"的事实源（每次上传都是新的一行，旧行不删——`updateOwnProfile` 清空头像时只是
 * 把 `credentials.avatar_artifact_id` 置空，不删对象存储里的字节，见该方法注释），而
 * `credentials.avatar_artifact_id`/`avatar_url` 只是"当前生效的是哪一个"这个指针。两张
 * 表两个仓储，同 F11 "teams 与 org_memberships 是两个独立 provider" 的分法。
 */

export interface AvatarRow {
  readonly artifactId: string;
  readonly userId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface AvatarRepository {
  /** 落 PG 元数据（对象存储的字节由调用方先行写入 `ObjectStore`，见 upload-own-avatar.ts）。 */
  create(row: AvatarRow): Promise<void>;
  /** `updateOwnProfile` 校验"这个 artifactId 是不是当前用户的"。不是当前用户的返回 null。 */
  findOwned(artifactId: string, userId: string): Promise<AvatarRow | null>;

  /**
   * 下载路由用——头像本身不是机密内容（同显示名，产品里到处要展示给别人看），所以下载
   * 不做"是不是自己的"这层所有权校验，需要一个不限 `userId` 的查询。
   */
  findAnyById(artifactId: string): Promise<AvatarRow | null>;
}

export const AVATAR_REPOSITORY = Symbol("AvatarRepository");
