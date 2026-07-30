/**
 * 组织成员邀请的域规则（F10 / UC-1.6）—— 最内层，纯函数，没有库、没有 HTTP。
 *
 * ## 这里**没有**的东西，比有的东西重要
 *
 * 没有「激活」。I-1（核销令牌 + 建 org_membership + 写角色与团队必须同一事务）
 * 是一串写操作的性质，纯函数托不住它；写一个「代表」那个事务的 `activate()`
 * 只会让唯一可能真正失败的那条不变量拿到一个绿色的域测试。它被断言在它真正存在的地方：
 * `tests/auth/activation-member-creation-atomic.test.ts`，对真实事务。
 *
 * 也没有「读服务端记录的角色」。I-2（链接身份以服务端为准）同样是一次**查表**的性质，
 * 不是一次计算的性质。这里能做的只有：把「声明值 vs 记录值」的比较写成一处
 * （`detectTamper`），好让审计与断言不各自发明一份比较逻辑。
 */
import { randomBytes } from "node:crypto";

/**
 * 激活链接有效期 —— **全仓唯一一份**，7 天（O-28 ④）。
 *
 * ⚠ 为什么不加进 `AUTH_POLICY`：契约 `org-admin.ts` 的 `KNOWN_CONTRACT_GAPS.OA3` 已经
 * 逐字裁定过这件事——`AUTH_POLICY` 里只有 `resetLinkHours`（重置密码），没有邀请链接的天数，
 * 而在 `org-admin.ts` 里补一个就是**第二处策略数值声明点**。本文件采用与
 * `INVITE_CODE_VALIDITY_MS`（90 天，`registration.ts`）**完全相同**的处置：
 * 域常量一份，SQL 里没有对应的 `DEFAULT now() + interval`，
 * `expires_at` 由应用层算好再写库。
 *
 * ⚠ 所以 OA3 **没有被本 feature 关闭**——它只是被安置在一个不会产生副本的地方。
 * 真正关闭它要么是把 `orgInviteLinkDays` 加进 `AUTH_POLICY`（跨 phase-00 契约改动），
 * 要么是裁定域常量就是单一事实源。两条都需要人裁，agent 不替人裁。
 */
export const ORG_INVITE_LINK_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 激活令牌。**这一枚是秘密**——持有它即可成为该组织的成员。
 *
 * 256 位 CSPRNG，base64url（与 `newVerificationToken` 同规格同理由：URL 里不至于太长）。
 * ⚠ 刻意**不**把 orgId / 角色 / 邮箱编进令牌。可解码的令牌意味着「链接里明文写着角色」
 * 这件事从查询串搬进了令牌本身，而客户端照样能改——I-2 要挡的越权面一点没变小，
 * 只是变得看不见了。
 */
export function newOrgInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 邀请行 id。不可从邮箱推导：它会进 URL 与日志。 */
export function newOrgInviteId(): string {
  return `oi-${randomBytes(12).toString("hex")}`;
}

/**
 * I-3 / O-28 ⑥：**邀请一名管理员不签发令牌**，先进双人复核队列。
 *
 * 「提权动作被单个被盗账号执行即等于整个组织沦陷」——所以这一条是
 * 由**被邀请的角色**决定的，与邀请人是谁无关。写成函数而不是 `if (role === "admin")`
 * 散在两处（用例一处、仓储一处），因为那两处只要有一处漏了，
 * 表现是「管理员邀请照常发出链接」，而 status 字段仍然写着 awaiting-review。
 */
export function needsDualReview(orgRole: string): boolean {
  return orgRole === "admin";
}

/** 依 `needsDualReview` 推出的初始 status。取值集合与契约 `OrgInviteStatus` 一致。 */
export function initialInviteStatus(orgRole: string): "pending" | "awaiting-review" {
  return needsDualReview(orgRole) ? "awaiting-review" : "pending";
}

/**
 * 链接里声明的身份 —— **不可信输入**，类型名就说明了它的用途。
 *
 * 它存在的唯一理由是「篡改尝试写安全审计」（usecases.md `ActivateOrgMember`）。
 * 不收下它，「篡改无效」只能证明到「我们没读」，证明不到「有人试过」。
 */
export interface UntrustedLinkClaims {
  readonly orgId: string | null;
  readonly orgRole: string | null;
  readonly teamId: string | null;
}

/** 服务端记录值 —— 授予恒等于它。 */
export interface ServerRecordedGrant {
  readonly orgId: string;
  readonly orgRole: string;
  readonly teamId: string | null;
}

/**
 * 声明值与记录值有没有对不上。
 *
 * ⚠ `null` 的声明项**不算篡改**：链接里没带这一项，不是「带了个假的」。
 * 把「没说」当成「说错了」会让每一次正常的免登激活都写一条安全审计，
 * 于是这张表里全是噪音，真正的那一条没人看得见。
 */
export function detectTamper(
  claims: UntrustedLinkClaims,
  actual: ServerRecordedGrant,
): boolean {
  if (claims.orgId !== null && claims.orgId !== actual.orgId) return true;
  if (claims.orgRole !== null && claims.orgRole !== actual.orgRole) return true;
  if (claims.teamId !== null && claims.teamId !== actual.teamId) return true;
  return false;
}
