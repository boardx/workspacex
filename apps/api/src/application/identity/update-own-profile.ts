/**
 * `updateOwnProfile`（#638 delta；迭代 1 落 `displayName`，迭代 2 补 `avatarArtifactId`，
 * 迭代 4 补写 provenance）
 *
 * 迭代 2：`avatarArtifactId` 非 null 时，校验它是 `uploadOwnAvatar` 为**当前用户**签发的
 * artifact（`AvatarRepository.findOwned`）——不属于当前用户 ⇒ `AVATAR_ARTIFACT_NOT_OWNED`，
 * 不接受任意字符串。验过写 `credentials.avatar_artifact_id` + `avatar_url`。`null` 清空回默认。
 *
 * 不接受修改邮箱——邮箱是登录凭据的一部分，改邮箱是另一个更敏感的操作。
 *
 * 迭代 4（#638 独立复核实测：六条写路径全部没写 provenance，`listOwnActivity` 永远读到
 * 空列表）：`displayName`/`avatarArtifactId` 分支分开写各自的事件——`profile-renamed` /
 * `avatar-changed`，不合并成一个类型 + `detail.op`（见 `packages/contracts/src/
 * provenance.ts` 里这两个成员的长注、ADR-101 的 #638 追加记录）。两个字段可以在同一次
 * 调用里都给出（前端目前不会这样做，但契约允许），此时**两条事件都写**——那是两件
 * 分别发生的事，写成一条会丢失"到底改了哪个字段"这个区分。target 用新增的 `account`
 * kind、id 是调用者自己的 `userId`：这不是组织/项目成员关系（`membership` 已被那个场景
 * 占用），是账户本身的字段变更。
 */
import type { OrgId } from "../../domain/org-id";
import type { CredentialRepository } from "../auth/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { AvatarRepository } from "./avatar-ports";

export class UpdateOwnProfileError extends Error {
  constructor(readonly reasonCode: "INVALID_INPUT" | "AVATAR_ARTIFACT_NOT_OWNED") {
    super(reasonCode);
  }
}

export interface UpdateOwnProfileDeps {
  readonly credentials: CredentialRepository;
  readonly avatars: AvatarRepository;
  readonly provenance: ProvenanceWriter;
}

export interface UpdateOwnProfileInput {
  readonly userId: string;
  readonly orgId: OrgId;
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

    await deps.provenance.append({
      orgId: input.orgId,
      type: "profile-renamed",
      actorId: input.userId,
      target: { kind: "account", id: input.userId },
      detail: { displayName: row.displayName },
    });
  }

  if (input.avatarArtifactId !== undefined) {
    if (input.avatarArtifactId === null) {
      const row = await deps.credentials.updateAvatar(input.userId, null, null);
      if (row === null) throw new UpdateOwnProfileError("INVALID_INPUT");
      latest = { displayName: row.displayName, avatarUrl: row.avatarUrl };

      await deps.provenance.append({
        orgId: input.orgId,
        type: "avatar-changed",
        actorId: input.userId,
        target: { kind: "account", id: input.userId },
        detail: { avatarArtifactId: null, cleared: true },
      });
    } else {
      const owned = await deps.avatars.findOwned(input.avatarArtifactId, input.userId);
      if (owned === null) throw new UpdateOwnProfileError("AVATAR_ARTIFACT_NOT_OWNED");
      const avatarUrl = `/identity/me/avatar/${owned.artifactId}`;
      const row = await deps.credentials.updateAvatar(input.userId, owned.artifactId, avatarUrl);
      if (row === null) throw new UpdateOwnProfileError("INVALID_INPUT");
      latest = { displayName: row.displayName, avatarUrl: row.avatarUrl };

      await deps.provenance.append({
        orgId: input.orgId,
        type: "avatar-changed",
        actorId: input.userId,
        target: { kind: "account", id: input.userId },
        detail: { avatarArtifactId: owned.artifactId, cleared: false },
      });
    }
  }

  // 理论不可达：至少一个分支执行过（前置校验已保证），latest 必被赋值。
  if (latest === null) throw new UpdateOwnProfileError("INVALID_INPUT");
  return latest;
}
