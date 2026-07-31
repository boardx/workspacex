/**
 * `resendPortalToken`（F86 / uc-6-3 R3 步骤 4）—— 受访者自助重发门户长效令牌到本人邮箱/手机。
 *
 * ⚠ **同一枚令牌**，`expiresAt` 不变——有效期挂在「材料保留期」上，不挂在
 * 「最近一次重发」上。把重发实现成「延长/换发一枚新令牌」，会让「材料还在，
 * 撤回权就在」这句话的另一半悄悄变成「只要还在重发，撤回权就在」，
 * 两者不是同一条不变量。
 * ⚠ 已撤销 / 已过期的令牌不能被重发——重发不是起死回生的手段（`TOKEN_INVALID`）。
 */
import { TokenInvalidError } from "./errors";
import type { PortalTokenRepository } from "./consent-token-ports";

export interface ResendPortalTokenDeps {
  readonly repo: PortalTokenRepository;
  readonly now?: () => Date;
}

export interface ResendPortalTokenInput {
  readonly portalToken: string;
}

export interface ResendPortalTokenOutput {
  readonly tokenId: string;
  readonly expiresAt: string;
}

export async function resendPortalToken(
  deps: ResendPortalTokenDeps,
  input: ResendPortalTokenInput,
): Promise<ResendPortalTokenOutput> {
  const now = (deps.now ?? (() => new Date()))();
  const lookup = await deps.repo.findActive(input.portalToken, now);
  if (!lookup.ok) throw new TokenInvalidError();

  return {
    tokenId: lookup.row.tokenId,
    expiresAt: lookup.row.expiresAt.toISOString(),
  };
}
