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

/**
 * 共享邀请链接（shared-invite-links delta）的查询参数名。与单人 token 的 `?t=`
 * **刻意分开**：两种令牌语义不同（一次性 vs 多次），同一个参数名会让激活页猜
 * 「这枚该打哪个端点」——参数名本身就是分发依据。
 */
export const SHARED_LINK_TOKEN_PARAM = "lt";

/** 管理端：把共享链接令牌拼成可分享的绝对链接（同一个激活页，link 模式）。 */
export function buildSharedInviteLink(token: string, origin: string): string {
  return `${origin}${ACTIVATION_PAGE_PATH}?${SHARED_LINK_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/**
 * 篡改声明值的三个查询参数名（issue #592 残余缺口）。
 *
 * `org-invite.controller.ts` 的 `claimOf` 从激活请求的**查询串**读这三个值，唯一去处是
 * `org_invite_tamper_attempts`——它们对授予没有任何影响（契约 `activateOrgMember.in`
 * 里根本没有这三个字段），但**不收就没得审计**：那样「篡改无效」只能证明到「我们没读」，
 * 证明不到「有人试过」。controller 注释里那句「由激活落地页把 `?org=&role=&team=`
 * 原样带上」说的就是本文件这组名字——激活页 URL 与激活请求 URL 共用同一组，不各写一份。
 *
 * ⚠ 与上面 `buildActivationLink` **不矛盾**：管理端拼链接时不**签发**这三个参数
 *   （带上只是给受邀人一个「链接里写着我的角色」的错觉）。这里做的是另一件事——
 *   把**受邀人手里那条链接上实际出现**的声明值原样转交给服务端留痕。
 *   不发明声明值，也不丢弃已经出现的声明值。
 */
export const ACTIVATION_CLAIM_PARAMS = ["org", "role", "team"] as const;

/** 可直接交给 `apiRequest` 的 `query`：`undefined` = 「没说」，不会出现在 URL 上。 */
export type ActivationLinkClaims = Record<(typeof ACTIVATION_CLAIM_PARAMS)[number], string | undefined>;

/**
 * 从激活页自己的 `searchParams` 读出声明值。
 *
 * ⚠ 判定逐字照搬服务端的 `claimOf`：**非字符串（重复参数给出的数组）与空串都算「没说」**。
 *   这里不另立一套（比如"取数组第一项"）——同一个事实在两处有两种判法，正是
 *   AGENTS.md 点名的那种漂移；而且「没说」被当成「说错了」会让每一次正常激活都写一条
 *   安全审计，真正的那一条就淹了（`detectTamper` 的注释写的是同一件事）。
 */
export function readActivationClaims(
  searchParams: Record<string, string | string[] | undefined>,
): ActivationLinkClaims {
  const claim = (name: string): string | undefined => {
    const raw = searchParams[name];
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  };
  return { org: claim("org"), role: claim("role"), team: claim("team") };
}
