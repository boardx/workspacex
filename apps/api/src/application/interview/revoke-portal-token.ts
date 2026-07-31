/**
 * `revokePortalToken`（F86 / uc-6-3 R3 步骤 4 收尾）—— 研究员单条撤销门户长效令牌。
 *
 * 幂等：撤销一枚已撤销的令牌不是错误（同 `revoke-invite-links.ts` 的立场——
 * 重复点 [撤销] 不该在第二次弹红条）。这里**没有**「重置全部」的对应语义：
 * 门户令牌是**一人一枚**（受访者本人持有），不像邀请链接那样有「本项目全部链接」
 * 这个批量维度，所以端口只有 `revoke(tokenId)`，不带 `null = 全部` 的分支。
 */
import type { PortalTokenRepository } from "./consent-token-ports";

export interface RevokePortalTokenDeps {
  readonly repo: PortalTokenRepository;
  readonly now?: () => Date;
}

export interface RevokePortalTokenInput {
  readonly tokenId: string;
}

export interface RevokePortalTokenOutput {
  readonly revoked: boolean;
}

export async function revokePortalToken(
  deps: RevokePortalTokenDeps,
  input: RevokePortalTokenInput,
): Promise<RevokePortalTokenOutput> {
  const now = (deps.now ?? (() => new Date()))();
  return deps.repo.revoke(input.tokenId, now);
}
