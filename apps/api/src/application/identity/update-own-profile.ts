/**
 * `updateOwnProfile`（#638 delta；迭代 1 落 `displayName`，迭代 2 补 `avatarArtifactId`）
 *
 * 迭代 2：`avatarArtifactId` 非 null 时，校验它是 `uploadOwnAvatar` 为**当前用户**签发的
 * artifact（`AvatarRepository.findOwned`）——不属于当前用户 ⇒ `AVATAR_ARTIFACT_NOT_OWNED`，
 * 不接受任意字符串。验过写 `credentials.avatar_artifact_id` + `avatar_url`。`null` 清空回默认。
 *
 * 不接受修改邮箱——邮箱是登录凭据的一部分，改邮箱是另一个更敏感的操作。
 */
import type { CredentialRepository } from "../auth/ports";
import type { AvatarRepository } from "./avatar-ports";

export class UpdateOwnProfileError extends Error {
  constructor(readonly reasonCode: "INVALID_INPUT" | "AVATAR_ARTIFACT_NOT_OWNED") {
    super(reasonCode);
  }
}

export interface UpdateOwnProfileDeps {
  readonly credentials: CredentialRepository;
  readonly avatars: AvatarRepository;
}

export interface UpdateOwnProfileInput {
  readonly userId: string;
  readonly displayName?: string;
  readonly avatarArtifactId?: string | null;
}

export interface UpdateOwnProfileOutput {
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export async function updateOwnProfile(
  deps: UpdateOwnProfileDeps,
  input: UpdateOwnProfileInput,
): Promise<UpdateOwnProfileOutput> {
  if (input.displayName === undefined && input.avatarArtifactId === undefined) {
    // 两个可写字段都没给：没有可执行的更新。
    throw new UpdateOwnProfileError("INVALID_INPUT");
  }

  let latest: { displayName: string; avatarUrl: string | null } | null = null;

  if (input.displayName !== undefined) {
    const row = await deps.credentials.updateDisplayName(input.userId, input.displayName);
    if (row === null) throw new UpdateOwnProfileError("INVALID_INPUT");
    latest = { displayName: row.displayName, avatarUrl: row.avatarUrl };
  }

  if (input.avatarArtifactId !== undefined) {
    if (input.avatarArtifactId === null) {
      const row = await deps.credentials.updateAvatar(input.userId, null, null);
      if (row === null) throw new UpdateOwnProfileError("INVALID_INPUT");
      latest = { displayName: row.displayName, avatarUrl: row.avatarUrl };
    } else {
      const owned = await deps.avatars.findOwned(input.avatarArtifactId, input.userId);
      if (owned === null) throw new UpdateOwnProfileError("AVATAR_ARTIFACT_NOT_OWNED");
      const avatarUrl = `/identity/me/avatar/${owned.artifactId}`;
      const row = await deps.credentials.updateAvatar(input.userId, owned.artifactId, avatarUrl);
      if (row === null) throw new UpdateOwnProfileError("INVALID_INPUT");
      latest = { displayName: row.displayName, avatarUrl: row.avatarUrl };
    }
  }

  // 理论不可达：至少一个分支执行过（前置校验已保证），latest 必被赋值。
  if (latest === null) throw new UpdateOwnProfileError("INVALID_INPUT");
  return latest;
}
