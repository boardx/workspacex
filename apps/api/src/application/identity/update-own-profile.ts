/**
 * `updateOwnProfile`（#638 delta，迭代 1）—— 自助改个人资料。
 *
 * ⚠ 本轮只有 `displayName` 有真实可用的路径。`avatarArtifactId` 非 null 时一律
 *   `INVALID_INPUT`——`uploadOwnAvatar` 本轮未实现，没有任何 artifact 能通过
 *   "属于当前用户"校验，接受它会制造一个看似生效、实则从未落库的假象。
 *
 * 不接受修改邮箱——邮箱是登录凭据的一部分（delta §2 逐字）。
 */
import type { CredentialRepository } from "../auth/ports";

export class UpdateOwnProfileError extends Error {
  constructor(readonly reasonCode: "INVALID_INPUT" | "AVATAR_ARTIFACT_NOT_OWNED") {
    super(reasonCode);
  }
}

export interface UpdateOwnProfileDeps {
  readonly credentials: CredentialRepository;
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
  // 迭代 1：avatarArtifactId 字段已写进 zod（契约完整形状），但没有任何服务端路径
  // 能验证它"属于当前用户"——uploadOwnAvatar 未实现，所以任何非 null 值都拒绝，
  // 而不是悄悄忽略（悄悄忽略会让调用方以为头像已生效）。
  if (input.avatarArtifactId !== undefined && input.avatarArtifactId !== null) {
    throw new UpdateOwnProfileError("INVALID_INPUT");
  }

  if (input.displayName === undefined) {
    // 两个可写字段都没给：没有可执行的更新。
    throw new UpdateOwnProfileError("INVALID_INPUT");
  }

  const row = await deps.credentials.updateDisplayName(input.userId, input.displayName);
  if (row === null) throw new UpdateOwnProfileError("INVALID_INPUT");

  // 迭代 1：credentials 表没有头像列（delta 背景实测），avatarUrl 恒为 null。
  return { displayName: row.displayName, avatarUrl: null };
}
