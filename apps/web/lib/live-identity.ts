/**
 * `identity` 束的真实 API 薄封装（#638 delta，迭代 1），跟 `live-org-admin.ts` 同一个模式：
 * 类型全部从 `@repo/contracts` 推导，调用一律走 `apiRequest`。
 *
 * 本轮只封装 `updateOwnProfile`——`identity` 束其余操作（`resolveIdentity` 等）已经由
 * `session-provider.tsx` 直接消费，不在本文件重复封装。
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

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
