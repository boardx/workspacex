/**
 * "平台管理员" -- platform-admin-role delta，2026-09-03 人类反馈：平台超管纯环境变量
 * 授予，日常运营（看反馈、看系统异常）每次都要 SSH 改配置太重。这里加的是**权限更窄、
 * 落库、可在界面上授予**的第二个身份，不是把平台超管本身变成可点的开关——
 * `domain/system/platform-superuser.ts` 那条"不落库"的设计没有变，理由也还成立。
 *
 * 谁是平台管理员由 `PlatformAdminRepository`（数据库表 `platform_admins`）回答；
 * 本文件只定义"平台运营准入 = 平台超管 或 平台管理员"这一条组合判定，与
 * `isPlatformSuperuserEmail` 同一个纯函数风格，不读任何 IO，方便独立测试。
 *
 * ⚠ 这条判定只用于**准入**（看名册、看系统异常）。"谁能把别人设成平台管理员"是另一个、
 *   更严格的问题，答案永远是"只有平台超管"，见 `PlatformMemberController` 的
 *   `grantPlatformAdmin`/`revokePlatformAdmin`——那两条路由不调用这个函数，只认
 *   `PlatformSuperuserGuard`，本函数的存在不会、也不该被用来放宽那条线。
 */
export function isPlatformOperator(isSuperuser: boolean, isPlatformAdmin: boolean): boolean {
  return isSuperuser || isPlatformAdmin;
}
