/**
 * issue #4248 —— 组织管理员的「第一个价值时刻」漏斗读端点薄封装。
 * 契约：`firstValueEvents.operations.getOrgFirstValueFunnel`（`GET /org/first-value-funnel`，
 * 组织取自会话，非组织管理员 403 `NOT_ORG_ADMIN`）。响应一律过契约 schema 再交给界面。
 */
import { firstValueEvents as FV } from "@repo/contracts";
import { apiRequest } from "./api-client";

export type OrgFirstValueFunnel = FV.OrgFirstValueFunnelOutValue;

export async function getOrgFirstValueFunnel(): Promise<OrgFirstValueFunnel> {
  const op = FV.operations.getOrgFirstValueFunnel;
  return op.out.parse(await apiRequest<unknown>(op.path, { method: op.method }));
}
