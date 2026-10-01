/**
 * 组织首页配置（ad-hoc feature，Refs #4634）。类型从契约推导，调用一律走
 * `apiRequest`（同 `live-org-admin.ts` 头注的既有约定）。
 */
import { homeConfig } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, apiUrl, ApiError, extractReasonCode, getStoredSessionToken } from "./api-client";
import { sha256Hex } from "./live-org-admin";

function path(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`:${k}`, encodeURIComponent(v)), template);
}

export type HomeConfig = z.infer<typeof homeConfig.HomeConfig>;
export type QuickAction = z.infer<typeof homeConfig.QuickAction>;
export type QuickActionKey = z.infer<typeof homeConfig.QuickActionKey>;
export type RecommendedCapability = z.infer<typeof homeConfig.RecommendedCapability>;
export type BannerPreset = z.infer<typeof homeConfig.BannerPreset>;
export type RecommendedAgent = z.infer<typeof homeConfig.RecommendedAgent>;
export type HomeSections = z.infer<typeof homeConfig.HomeSections>;
export type UploadHomeBannerOut = z.infer<typeof homeConfig.operations.uploadHomeBanner.out>;

/** 与后端 `MAX_AVATAR_BYTES` / 契约 `uploadHomeBanner.in.sizeBytes` 同一个 5MB（前端只做提前提示，真校验在服务端）。 */
export const HOME_BANNER_MAX_BYTES = 5 * 1024 * 1024;
export const HOME_BANNER_ACCEPT = "image/png,image/jpeg,image/webp";
const UPLOAD_HOME_BANNER_TIMEOUT_MS = 60_000;
export type UpdateHomeConfigIn = z.infer<typeof homeConfig.operations.updateHomeConfig.in>;

/** 任意组织成员可读。 */
export async function getHomeConfig(orgId: string): Promise<HomeConfig> {
  return apiRequest<HomeConfig>(path(homeConfig.operations.getHomeConfig.path, { orgId }), { method: "GET" });
}

/** 仅组织 admin；非 admin 收到真实 403（`FORBIDDEN`），不在前端隐藏入口。 */
export async function updateHomeConfig(
  orgId: string,
  input: Omit<UpdateHomeConfigIn, "orgId">,
): Promise<HomeConfig> {
  return apiRequest<HomeConfig>(path(homeConfig.operations.updateHomeConfig.path, { orgId }), {
    method: "PUT",
    body: input,
  });
}

/**
 * 横幅图片上传（第一步，仅组织 admin）。元数据走查询串、字节是请求体本身——同
 * `live-org-admin.ts` 的 `uploadOrgAvatar`（含 60s 硬超时，不许让用户卡在无反馈的等待里）。
 * 真正生效要靠 `updateHomeConfig` 带着返回的 `bannerImageArtifactId`。
 */
export async function uploadHomeBanner(input: { orgId: string; file: File }): Promise<UploadHomeBannerOut> {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const contentType = input.file.type;
  const url = apiUrl(path(homeConfig.operations.uploadHomeBanner.path, { orgId: input.orgId }), {
    filename: input.file.name,
    sizeBytes: String(bytes.byteLength),
    sha256,
    contentType,
  });
  const token = getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    body: bytes,
    signal: AbortSignal.timeout(UPLOAD_HOME_BANNER_TIMEOUT_MS),
  });
  const text = await res.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, extractReasonCode(json), json);
  return json as UploadHomeBannerOut;
}
