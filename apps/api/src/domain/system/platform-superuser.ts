/**
 * "平台超管" -- 一个与组织角色（`OrgRole`）**完全无关**的身份，只为一件事存在：
 * 读 `error_logs`（见 `application/ports/error-log.port.ts` 的 `list()` 头注,
 * 以及 `@repo/contracts` 的 `system-error-logs.ts` 文件头注）。
 *
 * ## 为什么不是 `OrgRole` 的又一个值,也不落库
 *
 * `error_logs` 没有 `org_id`——把"谁能读它"关联到任何一个组织的角色,都会让
 * "在哪个组织当 admin"这件与本表毫无关系的事,变成"能看到全平台异常"的钥匙。
 * 落库（例如一个 `is_platform_superuser` 列）又会让这个身份继承所有组织级
 * 账户管理的操作面（邀请、转让、注销）——而这个身份唯一需要的操作是"读一张
 * 诊断表"，一个部署时配置、只有运维改得动的环境变量白名单就是全部它需要的。
 *
 * ⚠ 纯函数，不读 `process.env`——env 的读取留在调用方（`interface` 层的
 *   controller），这里只判定"给定这份白名单，这个邮箱在不在里面"，可独立测试。
 */
export function isPlatformSuperuserEmail(email: string, whitelist: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  if (normalized === "") return false;
  return whitelist.some((w) => w.trim().toLowerCase() === normalized);
}

/**
 * `PLATFORM_SUPERUSER_EMAILS` 环境变量（逗号分隔）解析成白名单数组。
 *
 * ⚠ 缺省是**空数组**，不是"放行所有人"——一个未配置该环境变量的部署环境，
 *   系统异常读接口应当对所有人 403，而不是意外全放开。
 */
export function platformSuperuserWhitelistFromEnv(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
