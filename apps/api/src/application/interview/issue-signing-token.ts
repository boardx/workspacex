/**
 * `issueSigningToken`（F86 / uc-6-3 R3 步骤 1）—— 研究员发出授权链接。
 *
 * 做：① 取该场访谈的四个渲染变量，任一缺失即拒绝，**不签发任何令牌**（E2：
 *     「发一份告知不完整的同意书比不发更糟」）② 签发一枚 7 天、一次性的签署令牌。
 *
 * 不做：**同意书文案的插值**——那是受访者打开链接时（`getConsentPage`）才发生的事，
 * 这里只保证「这场访谈具备可以被插值的四个变量」，不提前渲染。
 */
import {
  hasCompleteRenderParams,
  newSigningToken,
  newSigningTokenId,
  signingTokenExpiresAt,
} from "../../domain/interview/consent-token";
import { RetentionParamsMissingError } from "./errors";
import type {
  ConsentRenderParamsProvider,
  SigningTokenRepository,
} from "./consent-token-ports";

export interface IssueSigningTokenDeps {
  readonly repo: SigningTokenRepository;
  readonly renderParams: ConsentRenderParamsProvider;
  readonly now?: () => Date;
  /** 链接的对外前缀。注入而不是常量，理由同 `issue-invite-link.ts`：域名是部署事实。 */
  readonly baseUrl?: string;
}

export interface IssueSigningTokenInput {
  readonly interviewId: string;
  readonly subjectId: string;
}

export interface IssueSigningTokenOutput {
  readonly tokenId: string;
  readonly url: string;
  readonly expiresAt: string;
}

export const DEFAULT_CONSENT_BASE_URL = "https://workspacex.invalid";

export async function issueSigningToken(
  deps: IssueSigningTokenDeps,
  input: IssueSigningTokenInput,
): Promise<IssueSigningTokenOutput> {
  const params = await deps.renderParams.get(input.interviewId);
  if (!hasCompleteRenderParams(params)) {
    throw new RetentionParamsMissingError(input.interviewId);
  }

  const now = (deps.now ?? (() => new Date()))();
  const token = newSigningToken();
  const expiresAt = signingTokenExpiresAt(now);

  const issued = await deps.repo.issue({
    tokenId: newSigningTokenId(),
    token,
    interviewId: input.interviewId,
    subjectId: input.subjectId,
    issuedAt: now,
    expiresAt,
  });

  const base = deps.baseUrl ?? DEFAULT_CONSENT_BASE_URL;
  return {
    tokenId: issued.tokenId,
    url: `${base}/consent/${issued.token}`,
    expiresAt: issued.expiresAt.toISOString(),
  };
}
