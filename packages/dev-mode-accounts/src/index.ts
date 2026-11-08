/**
 * 开发模式预设账号 —— 唯一事实源。
 *
 * ## 这解决的问题
 *
 * agent 跑 e2e 时经常卡在"账号"本身：临时建账号互相踩踏（并发 worker 用同一账号登录会被
 * `kick-device-invalidates-session` 互踢，见 `apps/web/e2e/fullstack-smoke-fixture.ts` 的
 * 账号拆分注释）、密码要现记、角色边界靠每个 spec 自己重新猜。这个包只做一件事：
 * 给一份固定、覆盖两种可分配组织角色（管理员、成员）的预设账号表。
 * 角色集合来自 identity.AssignableOrgRole；项目角色与历史组织角色不在此建新账号。
 * 需要独立并发身份的 E2E 仍使用按 feature 隔离的种子夹具。
 *
 * ## 不是第二条登录路径
 *
 * 这些账号仍然经真实的 `POST /auth/login`（`apps/web/lib/auth.ts` `login()`）走完整认证
 * 链路（bcrypt 校验、lockout、session 签发）——不是一个绕过登录逻辑的后门。"跳过登录"指的是
 * agent 不用再现填 `/login` 表单、不用现建账号、不用现记密码，而不是绕开鉴权本身。
 *
 * ## 生产环境硬门
 *
 * 种子脚本（`apps/api/scripts/seed-dev-mode-accounts.ts`）与任何读取这份数据的运行时代码
 * 都必须先过 `assertDevModeAllowed()`——`NODE_ENV === "production"` 时直接抛错退出，
 * 与 `KERNEL_ALLOW_TEST_PRINCIPAL` 同一套"dev-only 行为必须硬门 + 反证"的范式
 * （见 `session-token-principal-resolver.ts`）。
 */
import { identity } from "@repo/contracts";
import { z } from "zod";

export const DEV_MODE_ORG_NAME = "Dev Mode Org";

/** 打开开发模式种子/登录 helper 的显式开关；不设置就什么都不做（不给可猜默认行为）。 */
export const DEV_MODE_ENABLED_ENV = "WORKSPACEX_DEV_MODE";

export const DevModeAccountSchema = z.object({
  role: identity.AssignableOrgRole,
  email: z.string().email(),
  password: z.string().min(12),
  displayName: z.string().min(1),
});
export type DevModeAccount = z.infer<typeof DevModeAccountSchema>;
export type DevModeOrgRole = z.infer<typeof identity.AssignableOrgRole>;

/**
 * 固定预设账号,一个可分配组织角色一个,邮箱/密码写死并随 repo 提交——
 * 只在非 production 且显式打开 `WORKSPACEX_DEV_MODE=1` 时才会被种进库或被拿来登录,
 * 因此把密码提交进代码库不是泄露风险(参照 `fullstack-smoke-fixture.ts` 里已有的
 * 硬编码测试密码,同一约定)。
 */
export const DEV_MODE_ACCOUNTS: readonly DevModeAccount[] = Object.freeze([
  {
    role: "admin",
    email: "dev-mode-admin@workspacex.test",
    password: "DevMode-Admin-Preset-2026!",
    displayName: "Dev Mode Admin",
  },
  {
    role: "consultant",
    email: "dev-mode-consultant@workspacex.test",
    password: "DevMode-Consultant-Preset-2026!",
    displayName: "Dev Mode Member",
  },
]);

export function getDevModeAccount(role: DevModeOrgRole): DevModeAccount {
  const found = DEV_MODE_ACCOUNTS.find((a) => a.role === role);
  if (!found) {
    throw new Error(
      `no dev-mode preset account for role "${role}" — valid roles: ${DEV_MODE_ACCOUNTS.map((a) => a.role).join(", ")}`,
    );
  }
  return found;
}

/**
 * dev-only 行为的统一硬门。production 环境下调用即抛错——
 * 与 `KERNEL_ALLOW_TEST_PRINCIPAL` 同一套约定,谁读这份预设账号数据都必须先过这道。
 */
export function assertDevModeAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "dev-mode preset accounts are unreachable in production (NODE_ENV=production) — this is not a bypass, it is test-only fixture data",
    );
  }
}

/** `WORKSPACEX_DEV_MODE=1` 且非 production 才算"开发模式已开启"。 */
export function isDevModeEnabled(): boolean {
  return process.env[DEV_MODE_ENABLED_ENV] === "1" && process.env.NODE_ENV !== "production";
}
