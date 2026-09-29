/**
 * `uploadHomeBanner` —— 首页横幅图片上传，**仅组织 admin**（授权在 controller）。
 *
 * 校验口径逐条照 `uploadOrgAvatar`（服务端重新做，不信任客户端声明）：
 *   ① 实际字节数 vs 硬上限（同一个 `MAX_AVATAR_BYTES`，只声明在 `upload-org-avatar.ts` 一处）；
 *   ② magic-byte 嗅探（`domain/files/mime-sniff`）必须与声明的 contentType 同族。
 * 两条都在写对象存储之前，被拒的文件不落地。
 */
import { sniffKind } from "../../domain/files/mime-sniff";
import type { OrgId } from "../../domain/org-id";
import { MAX_AVATAR_BYTES } from "../auth/upload-org-avatar";
import { HomeConfigDomainError } from "./home-config-errors";
import type { BannerContentType, HomeConfigRepository, StoredHomeBanner } from "./home-config-ports";

const CONTENT_TYPE_TO_SNIFFED = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" } as const;

export interface UploadHomeBannerInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly bytes: Uint8Array;
  readonly declaredContentType: BannerContentType;
  readonly declaredSha256: string;
}

export async function uploadHomeBanner(
  deps: { readonly repo: HomeConfigRepository },
  input: UploadHomeBannerInput,
): Promise<StoredHomeBanner> {
  const n = input.bytes.byteLength;
  if (n === 0 || n > MAX_AVATAR_BYTES) throw new HomeConfigDomainError("FILE_TOO_LARGE");
  if (sniffKind(input.bytes) !== CONTENT_TYPE_TO_SNIFFED[input.declaredContentType]) {
    throw new HomeConfigDomainError("UNSUPPORTED_CONTENT_TYPE");
  }
  return deps.repo.storeBanner(input.orgId, input.actorId, input.bytes, input.declaredContentType, input.declaredSha256);
}
