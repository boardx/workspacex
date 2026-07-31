/**
 * `getConsentPage`（F86 / uc-6-3 R3 步骤 2）—— 受访者打开授权页。
 *
 * ⚠ **只读**：校验签署令牌有效（未过期/未撤销/未使用），插值四个渲染变量，
 *   返回场次事实 + 四项措辞 + 数据控制方/联系人/合规邮箱。**不核销令牌**——
 *   受访者可能刷新页面、切换设备继续读，多次打开不消耗那枚一次性令牌。
 * ⚠ 令牌无效的四种理由（不存在/过期/已撤销/已使用）在这里**合并**成一个
 *   `TOKEN_INVALID`（契约 E1：不泄露「这个链接以前是有效的」）。
 */
import { CONSENT_ITEM_COPY, newConsentSnapshotId } from "../../domain/interview/consent-token";
import { TokenInvalidError } from "./errors";
import type {
  ConsentRenderParamsProvider,
  ConsentSessionFactsProvider,
  SigningTokenRepository,
} from "./consent-token-ports";
import { hasCompleteRenderParams } from "../../domain/interview/consent-token";

export interface GetConsentPageDeps {
  readonly repo: SigningTokenRepository;
  readonly renderParams: ConsentRenderParamsProvider;
  readonly sessionFacts: ConsentSessionFactsProvider;
  readonly now?: () => Date;
}

export interface GetConsentPageInput {
  readonly token: string;
}

export interface GetConsentPageOutput {
  readonly session: {
    readonly subjectAlias: string;
    readonly whenAt: string;
    readonly durationMinutes: number;
  };
  readonly items: readonly {
    readonly key: string;
    readonly label: string;
    readonly optOutConsequence: string;
  }[];
  readonly controller: {
    readonly org: string;
    readonly contactName: string;
    readonly complianceEmail: string;
  };
  /** 本次读取生成的渲染快照 id——插值一次算一个快照，供 `submitConsent` 落库时复用同一份告知内容。 */
  readonly snapshotId: string;
}

export async function getConsentPage(
  deps: GetConsentPageDeps,
  input: GetConsentPageInput,
): Promise<GetConsentPageOutput> {
  const now = (deps.now ?? (() => new Date()))();
  const lookup = await deps.repo.findActive(input.token, now);
  if (!lookup.ok) throw new TokenInvalidError();

  const params = await deps.renderParams.get(lookup.row.interviewId);
  // ⚠ 签发时已校验齐全（`issueSigningToken`），这里再判一次：渲染变量可能在
  // 签发之后被改成不完整（例如合规邮箱被清空）。「签发时对」不等于「打开时仍对」，
  // 这里不复用签发时的结论，重新读一次当下的值。
  if (!hasCompleteRenderParams(params)) throw new TokenInvalidError();

  const facts = await deps.sessionFacts.get(lookup.row.interviewId, lookup.row.subjectId);

  return {
    session: facts,
    items: CONSENT_ITEM_COPY.map((i) => ({
      key: i.key,
      label: i.label,
      optOutConsequence: i.optOutConsequence,
    })),
    controller: {
      org: params.dataController,
      contactName: params.contactName,
      complianceEmail: params.complianceEmail,
    },
    snapshotId: newConsentSnapshotId(),
  };
}
