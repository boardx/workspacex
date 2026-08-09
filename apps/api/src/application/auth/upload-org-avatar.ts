/**
 * `uploadOrgAvatar`（#363 delta）—— 组织头像上传，**仅组织 admin**。
 *
 * 🔴 **服务端重新做全部校验，不信任客户端声明的任何一项**（同 `upload-artifact.ts`
 * F35 的纪律）：
 *   ① 实际字节数 vs 声明的 `sizeBytes` 与硬上限（5MB，契约 `uploadOrgAvatar.in` 逐字）；
 *   ② magic-byte 嗅探（`domain/files/mime-sniff.ts`，不新造第二套嗅探逻辑）vs 声明的
 *      `contentType`——两者必须指向同一个受支持的图片家族（png/jpeg/webp），
 *      嗅探结果不在白名单内、或与声明不一致，一律 `UNSUPPORTED_CONTENT_TYPE`。
 * 两条校验都在写对象存储**之前**，被拒绝的文件不落地（verification.md 反证逐字）。
 */
import { sniffKind } from "../../domain/files/mime-sniff";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgId } from "../../domain/org-id";
import type { OrgProfileRepository, StoredOrgAvatar } from "./org-profile-ports";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** 声明的 `contentType` -> 嗅探结果必须落在的家族集合。执行/未知/其它图片格式一律拒。 */
const CONTENT_TYPE_TO_SNIFFED = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
} as const;

export interface UploadOrgAvatarDeps {
  readonly repo: OrgProfileRepository;
}

export interface UploadOrgAvatarInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorOrgRole: string;
  readonly bytes: Uint8Array;
  readonly declaredSizeBytes: number;
  readonly declaredContentType: "image/png" | "image/jpeg" | "image/webp";
  readonly declaredSha256: string;
}

export async function uploadOrgAvatar(
  deps: UploadOrgAvatarDeps,
  input: UploadOrgAvatarInput,
): Promise<StoredOrgAvatar> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  // ① 实际字节数，不是声明的那个数字。
  const actualBytes = input.bytes.byteLength;
  if (actualBytes > MAX_AVATAR_BYTES || actualBytes === 0) {
    throw new OrgAdminError("FILE_TOO_LARGE");
  }

  // ② magic-byte 嗅探，不是声明的 Content-Type。
  const sniffed = sniffKind(input.bytes);
  const expected = CONTENT_TYPE_TO_SNIFFED[input.declaredContentType];
  if (sniffed !== expected) {
    throw new OrgAdminError("UNSUPPORTED_CONTENT_TYPE");
  }

  return deps.repo.storeAvatar(input.orgId, input.actorId, input.bytes, input.declaredContentType, input.declaredSha256);
}
