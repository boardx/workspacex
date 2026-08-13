/**
 * 组织共享邀请链接的域规则（shared-invite-links delta）—— 纯函数，没有库、没有 HTTP。
 *
 * 与 `org-invite.ts`（单人邀请）的分工：`needsDualReview` 从那边 **import 复用**——
 * 「邀一个 admin 要双人复核」与「建一条 admin 级共享链接要双人复核」是**同一条不变量
 * （O-28⑥）的两个适用点**，判据（被授予的角色）也相同，第二份 `role === "admin"`
 * 就是第二处规则声明点。
 *
 * 这里**没有**「激活」（同 org-invite.ts 文件头的理由：I-1 是事务的性质，纯函数托不住），
 * 也没有「配额」（数座位是仓储在锁里做的事）。
 */
import { createHash, randomBytes } from "node:crypto";

export { needsDualReview } from "./org-invite";

/**
 * 有效期三档 → 毫秒（拍板①②）。**全仓唯一一份**——契约 `OrgInviteLinkExpiry` 声明
 * 档位集合，这里声明每档的时长；前端只显示档位标签，不算日期。
 * 与 `ORG_INVITE_LINK_VALIDITY_MS`（单人邀请 7 天，OA3 已裁域常量为单一事实源）
 * 同一处置：SQL 里没有对应的 DEFAULT interval，`expires_at` 由应用层算好再写库。
 */
export const ORG_INVITE_LINK_EXPIRY_MS = {
  "1d": 1 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

export type OrgInviteLinkExpiryKind = keyof typeof ORG_INVITE_LINK_EXPIRY_MS;

/**
 * 链接令牌。**这一枚是长期有效的秘密**——持有它即可（在过期/上限内）成为组织成员。
 * 256 位 CSPRNG，base64url，与 `newOrgInviteToken` 同规格同理由。
 */
export function newOrgInviteLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 令牌落库形态：sha-256 十六进制。**明文不落库**（delta contract.md 对照表）——
 * 单人 token 一次性短命，共享链接长期有效，同样一次 DB 泄露给出的东西完全不同。
 * 不加盐不拉伸：这是 256 位随机值不是人类口令，暴力面在 2^256 上，慢哈希只会
 * 把每次激活的查找变贵而不增加任何安全。
 */
export function hashOrgInviteLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 链接行 id。不含任何可推导信息：它会进列表与日志。 */
export function newOrgInviteLinkId(): string {
  return `oil-${randomBytes(12).toString("hex")}`;
}

/** 契约 `OrgInviteLinkStatus` 的存储子集。派生逻辑见 `deriveOrgInviteLinkStatus`。 */
export type StoredLinkStatus = "pending-review" | "active" | "revoked";
export type DerivedLinkStatus = StoredLinkStatus | "expired" | "exhausted";

/**
 * 存储态 + 时钟 + 计数 → 展示/判定用的五态。**唯一一份派生规则**：列表接口与
 * 激活判定都从这里出（激活侧在 SQL 里用等价的 WHERE 表达，测试断言两者一致——
 * 见 shared-invite-links.test.ts 的失效面反证）。
 *
 * 优先级：revoked > pending-review > expired > exhausted > active。
 * `revoked` 压过一切（人已明确作废）；`expired` 先于 `exhausted` 判——一条又过期
 * 又用满的链接说「已过期」比说「已用满」更接近它不能再用的原因（时间不可逆，
 * 上限理论上还能调）。
 */
export function deriveOrgInviteLinkStatus(row: {
  readonly status: StoredLinkStatus;
  readonly expiresAt: Date | null;
  readonly maxUses: number | null;
  readonly usedCount: number;
  readonly now: Date;
}): DerivedLinkStatus {
  if (row.status === "revoked") return "revoked";
  if (row.status === "pending-review") return "pending-review";
  if (row.expiresAt !== null && row.expiresAt.getTime() <= row.now.getTime()) return "expired";
  if (row.maxUses !== null && row.usedCount >= row.maxUses) return "exhausted";
  return "active";
}
