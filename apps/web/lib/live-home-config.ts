/**
 * 组织首页配置（ad-hoc feature，Refs #4634）。类型从契约推导，调用一律走
 * `apiRequest`（同 `live-org-admin.ts` 头注的既有约定）。
 */
import { homeConfig } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

function path(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`:${k}`, encodeURIComponent(v)), template);
}

export type HomeConfig = z.infer<typeof homeConfig.HomeConfig>;
export type QuickAction = z.infer<typeof homeConfig.QuickAction>;
export type QuickActionKey = z.infer<typeof homeConfig.QuickActionKey>;
export type RecommendedCapability = z.infer<typeof homeConfig.RecommendedCapability>;
export type BannerPreset = z.infer<typeof homeConfig.BannerPreset>;
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
