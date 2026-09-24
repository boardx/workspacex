/**
 * 薄适配层：Access 校验的实现只在 @repo/coord-access（单一事实源）。这里只把 Worker env
 * 映射过去，并保留本 Worker 既有契约——无效 token 回 401，未配置回 503（fail-closed）。
 */
import { checkAccess } from "@repo/coord-access";

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export type AccessResult = { ok: true } | { ok: false; status: 401 | 503 };

export async function verifyAccess(request: Request, env: AccessEnv, now = Date.now()): Promise<AccessResult> {
  const r = await checkAccess(request.headers, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }, { nowSec: now / 1000, invalidStatus: 401 });
  if (r.ok) return { ok: true };
  return { ok: false, status: r.status === 503 ? 503 : 401 };
}
