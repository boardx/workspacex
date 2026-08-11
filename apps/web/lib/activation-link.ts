/**
 * 组织邀请激活链接的**唯一**拼装/解析处（invite-link-and-reads delta ①）。
 *
 * coord-main 2026-08-11 裁决 A（token 返回式）：邮件通道接通之前，激活链接由发起
 * 邀请/重发的管理员从签发响应里拿到**一次**，自行转交受邀人。链接 = 前端激活页
 * 路由 + `?t=<token>`。路由字符串只在这里出现——管理端拼链接（org-admin-screen）
 * 与激活页读参数（app/(entry)/auth/activate）都 import 这里，不各写一份。
 *
 * ⚠ 链接里**只有 token**：`org-invite.controller.ts` 的激活端点会从查询串收
 *   `?org=&role=&team=` 三个"声明值"做篡改审计，但那三个值对授予没有任何影响
 *   （契约 `activateOrgMember.in` 里根本没有这三个字段）。管理端拼链接时不带它们
 *   ——带上只是给受邀人一个"链接里写着我的角色"的错觉，而权威恒在服务端记录。
 */

/** 激活页路由（app/(entry)/auth/activate/page.tsx）。 */
export const ACTIVATION_PAGE_PATH = "/auth/activate";

/** 查询参数名。 */
export const ACTIVATION_TOKEN_PARAM = "t";

/** 管理端：把签发响应里的一次性 token 拼成可转交的绝对链接。 */
export function buildActivationLink(token: string, origin: string): string {
  return `${origin}${ACTIVATION_PAGE_PATH}?${ACTIVATION_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}
