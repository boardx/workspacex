/**
 * `identity` 束的真实 API 薄封装（#638 delta，迭代 1 落 `updateOwnProfile`，
 * 迭代 2 补 `uploadOwnAvatar`/`changeOwnPassword`/`listOwnActivity`），跟 `live-org-admin.ts`
 * 同一个模式：类型全部从 `@repo/contracts` 推导，调用一律走 `apiRequest`（头像上传除外——
 * 那条走 multipart，`apiRequest` 只封装 JSON，见 `uploadOwnAvatar` 的注释）。
 *
 * 本文件不封装 `resolveIdentity` 等——已经由 `session-provider.tsx` 直接消费。
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import { apiBaseUrl, apiUrl, apiRequest, ApiError, getStoredSessionToken } from "./api-client";

export type UpdateOwnProfileOut = z.infer<typeof identity.operations.updateOwnProfile.out>;

export interface UpdateOwnProfileInput {
  readonly displayName?: string;
  readonly avatarArtifactId?: string | null;
}

export async function updateOwnProfile(input: UpdateOwnProfileInput): Promise<UpdateOwnProfileOut> {
  return apiRequest<UpdateOwnProfileOut>(identity.operations.updateOwnProfile.path, {
    method: "PATCH",
    body: { displayName: input.displayName, avatarArtifactId: input.avatarArtifactId },
  });
}

/* ─────────────────────────── uploadOwnAvatar（迭代 2）─────────────────────────── */

export type UploadOwnAvatarOut = z.infer<typeof identity.operations.uploadOwnAvatar.out>;

/**
 * 头像上传走 `multipart/form-data`，不走 `apiRequest`（那个函数只序列化 JSON body）——
 * 一个 `meta` 字段（JSON，须与 `uploadOwnAvatar.in` 一致）+ 一个 `file` 字段（二进制），
 * 与后端 `identity.controller.ts` 的 `uploadAvatar` 约定一致。
 */
export async function uploadOwnAvatar(file: File): Promise<UploadOwnAvatarOut> {
  const meta = {
    filename: file.name,
    sizeBytes: file.size,
    // 服务端不校验这个字段是否等于真实哈希（重做全部校验的是体积与 magic bytes，
    // 见 `upload-own-avatar.ts`）——这里传一个占位值，不在客户端算 SHA-256 只为填一个
    // 不被信任的字段。
    sha256: "client-declared",
    contentType: file.type,
  };
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("file", file, file.name);

  const token = getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl(identity.operations.uploadOwnAvatar.path), {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  const text = await res.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const reasonCode =
      typeof json === "object" && json !== null && "reasonCode" in json
        ? ((json as { reasonCode: unknown }).reasonCode as string | null)
        : null;
    throw new ApiError(res.status, reasonCode, json);
  }
  return json as UploadOwnAvatarOut;
}

/** 头像下载地址补成绝对 URL——`avatarUrl` 是后端返回的相对路径（`/identity/me/avatar/:id`）。 */
export function resolveAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  return apiUrl(avatarUrl);
}

/**
 * 头像 `<img>` 不能直接用 `avatarUrl`——下载路由要求 `Authorization` 头，浏览器的
 * `<img src>` 没有办法带自定义头。这里改用 `fetch` 取字节再转 `Blob URL`。
 */
export async function fetchAvatarObjectUrl(avatarUrl: string): Promise<string> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(avatarUrl), { headers, credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, null, null);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/* ─────────────────────────── changeOwnPassword（迭代 2）─────────────────────────── */

export type ChangeOwnPasswordOut = z.infer<typeof identity.operations.changeOwnPassword.out>;

export async function changeOwnPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ChangeOwnPasswordOut> {
  return apiRequest<ChangeOwnPasswordOut>(identity.operations.changeOwnPassword.path, {
    method: "POST",
    body: input,
  });
}

/* ─────────────────────────── listOwnActivity（迭代 2）─────────────────────────── */

export type ListOwnActivityOut = z.infer<typeof identity.operations.listOwnActivity.out>;

export async function listOwnActivity(input: {
  cursor: string | null;
  limit: number;
}): Promise<ListOwnActivityOut> {
  return apiRequest<ListOwnActivityOut>(identity.operations.listOwnActivity.path, {
    method: "GET",
    query: { cursor: input.cursor ?? "", limit: String(input.limit) },
  });
}

/** 供本文件外部使用（`fetchAvatarObjectUrl`/上传都要拼 origin），跟随既有导出习惯。 */
export { apiBaseUrl };
