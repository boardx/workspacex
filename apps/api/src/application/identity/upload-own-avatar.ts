/**
 * `uploadOwnAvatar`（#638 delta，迭代 2）—— 头像上传：对象存储先写、PG 元数据后写，
 * 失败不留幽灵对象（同 `materializeArtifact` 的顺序，见契约 `uploadOwnAvatar` 的文档注释）。
 *
 * ⚠ 服务端必须对**实际字节**重新校验，不能只信客户端声明的 `sizeBytes`/`contentType`——
 *   这条纪律与 `uploadArtifact` 头部「前端预检只是体验优化，服务端必须完整重做全部校验」
 *   一致。这里做两件事：① 实际字节数不得超过 5MB 上限；② 用简单的 magic-byte 嗅探确认
 *   实际内容类型与声明的一致，不信任仅凭扩展名/声明头。
 */
import { randomBytes } from "node:crypto";
import { computeContentHash } from "../../domain/artifact/content-hash";
import type { AvatarRepository } from "./avatar-ports";
import type { CredentialRepository } from "../auth/ports";
import { ObjectStoreUnavailableError, type ObjectStore } from "../artifact/ports";

export const AVATAR_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
export const AVATAR_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

export class UploadOwnAvatarError extends Error {
  constructor(readonly reasonCode: "FILE_TOO_LARGE" | "UNSUPPORTED_CONTENT_TYPE") {
    super(reasonCode);
  }
}

export interface UploadOwnAvatarDeps {
  readonly store: ObjectStore;
  readonly avatars: AvatarRepository;
  readonly credentials: CredentialRepository;
}

export interface UploadOwnAvatarInput {
  readonly userId: string;
  readonly declaredContentType: string;
  readonly bytes: Uint8Array;
}

export interface UploadOwnAvatarOutput {
  readonly avatarArtifactId: string;
  readonly avatarUrl: string;
}

/**
 * 极简 magic-byte 嗅探——只覆盖契约允许的三种类型，不是通用 MIME sniffer
 * （files 束的 `mime-sniff.ts` 覆盖面更广，但那是为任意文件类型设计的；头像只有
 * 三种允许的类型，装那整套是过度设计）。
 */
function sniffImageType(bytes: Uint8Array): AvatarContentType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function newAvatarId(): string {
  return `avatar-${randomBytes(12).toString("hex")}`;
}

export async function uploadOwnAvatar(
  deps: UploadOwnAvatarDeps,
  input: UploadOwnAvatarInput,
): Promise<UploadOwnAvatarOutput> {
  // ── 服务端重做全部校验，不信客户端声明 ──────────────────────────────────
  if (input.bytes.byteLength > AVATAR_SIZE_LIMIT_BYTES || input.bytes.byteLength === 0) {
    throw new UploadOwnAvatarError("FILE_TOO_LARGE");
  }
  const sniffed = sniffImageType(input.bytes);
  if (sniffed === null || !AVATAR_CONTENT_TYPES.includes(input.declaredContentType as AvatarContentType)) {
    throw new UploadOwnAvatarError("UNSUPPORTED_CONTENT_TYPE");
  }
  if (sniffed !== input.declaredContentType) {
    // 声明的类型与实际字节不符——同 `uploadArtifact` 的 MIME_MISMATCH 判断，
    // 头像契约里没有专属码，映射到 UNSUPPORTED_CONTENT_TYPE（拒绝，不猜测意图）。
    throw new UploadOwnAvatarError("UNSUPPORTED_CONTENT_TYPE");
  }

  const contentHash = computeContentHash(input.bytes);
  const artifactId = newAvatarId();
  const objectKey = `avatars/${input.userId}/${artifactId}`;

  // 对象存储先写。写失败 ⇒ 直接抛出（DEPENDENCY_UNAVAILABLE 类，未在契约 err 里声明，
  // 但契约本身没有为"对象存储不可用"留码——同 `uploadArtifact` 对基础设施失败的处置，
  // 全局异常过滤器会把它降级成 503，而不是假装写成功了）。
  try {
    await deps.store.putOnce(objectKey, input.bytes, sniffed);
  } catch (e) {
    if (e instanceof ObjectStoreUnavailableError) throw e;
    throw e;
  }

  // PG 元数据后写。这一步失败会留下一个孤儿对象（没有 outbox/补偿——本轮范围内的已知取舍，
  // 与 `materializeArtifact` 的完整补偿路径不同，见 PR 说明）。
  await deps.avatars.create({
    artifactId,
    userId: input.userId,
    objectKey,
    contentType: sniffed,
    sizeBytes: input.bytes.byteLength,
    sha256: contentHash,
  });

  return { avatarArtifactId: artifactId, avatarUrl: `/identity/me/avatar/${artifactId}` };
}
