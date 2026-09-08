import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #3068 / #3072 —— 「以后都允许」写下的组织级常驻授权（`tool_permission_grants`
 * 的 `scope='forever'` 行）的夹具清理，**走产品端点**，不直连库。
 *
 * ## 为什么需要它
 *
 * `copilotkit-v2-hitl.spec.ts` 的 forever 用例点一次「以后都允许」，就往这个**共享**的
 * chat-read e2e 组织写下一条跨 run、无过期的授权；此后同组织所有同类调用被 `hasGrant`
 * 自动放行。`copilotkit-v2-uiux-shots.spec.ts:119`（审批弹层截图）于是永远等不到
 * `chat-tool-permission-dialog`——`error-context.md` 快照里那一行是决定性证据：
 * `- status: 正在执行技能脚本（quarterly-report）…`，run 直接执行了，弹层根本没出现
 * （#3072 ③ 的取证）。清掉的是**上一个用例留下的污染**，被验的行为一字未放宽。
 *
 * ## 为什么走端点而不是删库
 *
 * 迁移 `20260905120000_f06_tool_permission_tiering.sql` 对 `tool_permission_grants`
 * 只授 SELECT/INSERT（授权记录是审计留痕，R9）。coordinator 在 #3072 的裁决即是
 * 「等 #3068 的撤销端点落地后走产品路径」——PR #3075 提供了 `GET /tool-permission-grants`
 * 与 `DELETE /tool-permission-grants/:grantId`（`requireOrgAdmin`），撤销本身在
 * `tool_permission_revocations` 留痕，所以清理动作自己也是可审计的。
 */

/**
 * chat-read 夹具组织里的**组织 admin** 账号。
 *
 * `CHAT_READ_E2E.email` 那个用户恒是 `addOrgMember(..., "lead", null)`（`seed-chat-read-e2e.ts`
 * 里写明：改它的角色会动到本夹具其余全部用例的 RBAC 前提），而这两个端点的判据是
 * `requireOrgAdmin`。种子脚本里本来就有一个专供后台写入的 admin（原用于建画布模板），
 * 这里复用它。邮箱形状与种子里的 `canvas-admin+${ORG_ID}@example.invalid` 逐字对应，
 * 口令同为 `CHAT_READ_E2E.password`（种子对所有账号用同一份 hash）。
 */
export const CHAT_READ_E2E_ORG_ADMIN = {
  email: `canvas-admin+${CHAT_READ_E2E.orgId}@example.invalid`,
  password: CHAT_READ_E2E.password,
} as const;

/** 最小 HTTP 形状：Node 全局 `fetch` 天然满足；单元反证喂替身。 */
export interface StandingGrantHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type StandingGrantFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<StandingGrantHttpResponse>;

/**
 * 撤销本夹具组织现存的全部常驻（forever）工具授权。
 *
 * @param baseUrl 同源入口（chat-read 下 `/auth/*` 与 `/tool-permission-grants*` 都由
 *   `next.config.mjs` 的 rewrite 代理到真实 API，见 #3068 补的那两条）。
 * @returns 实际撤销掉的 grantId（空数组 = 组织本来就干净）。
 */
export async function revokeAllStandingToolGrants(
  baseUrl: string,
  fetchImpl: StandingGrantFetch = globalThis.fetch as unknown as StandingGrantFetch,
): Promise<readonly string[]> {
  const login = await fetchImpl(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CHAT_READ_E2E_ORG_ADMIN),
  });
  if (!login.ok) {
    throw new Error(`[standing-grant-cleanup] 组织 admin 登录失败：HTTP ${login.status}`);
  }
  const { sessionToken } = (await login.json()) as { sessionToken: string };
  const auth = { authorization: `Bearer ${sessionToken}` };

  const listed = await fetchImpl(`${baseUrl}/tool-permission-grants`, { method: "GET", headers: auth });
  if (!listed.ok) {
    throw new Error(`[standing-grant-cleanup] 列举常驻授权失败：HTTP ${listed.status}`);
  }
  const rows = (await listed.json()) as readonly { grantId: string }[];

  const revoked: string[] = [];
  for (const row of rows) {
    const deleted = await fetchImpl(
      `${baseUrl}/tool-permission-grants/${encodeURIComponent(row.grantId)}`,
      { method: "DELETE", headers: auth },
    );
    // 404 = 同一行已被别处撤掉（另一个 worker 的收尾、或管理员在界面上点了撤销）。
    // 对清理而言与撤成功是同一件事，不算失败。
    if (!deleted.ok && deleted.status !== 404) {
      throw new Error(`[standing-grant-cleanup] 撤销 ${row.grantId} 失败：HTTP ${deleted.status}`);
    }
    revoked.push(row.grantId);
  }
  return revoked;
}
