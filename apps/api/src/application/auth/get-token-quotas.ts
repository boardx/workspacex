/**
 * F160 `getTokenQuotas` —— 「成员配额」tab 整屏的读用例。
 *
 * 三张卡的数字全部在这里派生，**不在前端算**：已分配 / 未分配 / 超支预警人数。
 * 放前端算的话，同一个「85%」阈值就会同时活在前端和限额策略（F162）两处——
 * 这个仓已经因为「同一事实两处声明」栽过五次。
 */
import type { OrgId } from "../../domain/org-id";
import type { TokenQuotaRepository } from "./token-quota-ports";

/**
 * 「超支预警」的判据：已用 ≥ 自身额度的 85%。
 *
 * ⚠ 单一事实源。原型（`lib/mock/admin.ts` 的三张卡）写的是「已用 > 85%」，
 * `admin-limits.ts` 的成员级降级阈值也写 85——F162 落地时**必须引用这个常量**，
 * 不得在限额规则里再写一遍 0.85。
 */
export const OVERSPEND_WARNING_RATIO = 0.85;

export interface GetTokenQuotasDeps {
  readonly repo: TokenQuotaRepository;
}

export interface GetTokenQuotasOutput {
  readonly orgBudget: number | null;
  readonly allocated: number;
  readonly unallocated: number | null;
  readonly orgUsed: number;
  readonly overspendCount: number;
  readonly members: readonly {
    readonly userId: string;
    readonly displayName: string;
    readonly email: string;
    readonly orgRole: string;
    readonly teamId: string | null;
    readonly monthlyLimit: number | null;
    readonly usedTokens: number;
  }[];
}

export async function getTokenQuotas(
  deps: GetTokenQuotasDeps,
  input: { readonly orgId: OrgId },
): Promise<GetTokenQuotasOutput> {
  const snapshot = await deps.repo.readSnapshot(input.orgId);

  // 未设置组织额度时 `unallocated` 也是 null，**不是 0**：0 会在界面上读成
  // 「一个 token 都分不出去了」，而真实状态是「还没有人给这个组织设过额度」。
  const unallocated = snapshot.orgBudget === null ? null : snapshot.orgBudget - snapshot.allocated;

  // 未分配额度的人（monthlyLimit === null）不计入超支预警：没有额度就没有「超」的参照系。
  // 他们的用量仍然计进 `orgUsed`——用了就是用了，与有没有分配无关。
  const overspendCount = snapshot.members.filter(
    (m) => m.monthlyLimit !== null && m.monthlyLimit > 0
      && m.usedTokens >= m.monthlyLimit * OVERSPEND_WARNING_RATIO,
  ).length;

  return {
    orgBudget: snapshot.orgBudget,
    allocated: snapshot.allocated,
    unallocated,
    orgUsed: snapshot.orgUsed,
    overspendCount,
    members: snapshot.members,
  };
}
