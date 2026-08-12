/**
 * F160 —— 两条写用例：设某人的月度额度 / 设组织月度额度。
 *
 * 两条都极薄：真正的判定（I-Q1 逐人之和 ≤ 组织额度、以及调低组织额度不得低于已分配）
 * 必须与写在**同一个事务**里，所以住在仓储的 `SELECT ... FOR UPDATE` 里，不在这一层。
 * 把校验搬上来会得到一个「读一次、算一算、再写」的经典竞态：两个管理员同时提额双双
 * 通过、合计超发，而且两次请求各自看起来完全正常。
 *
 * 这一层负责的是**顺序**：先确认目标是本组织成员，再写。给一个外人设额度应当是
 * `MEMBER_NOT_FOUND`，而不是往表里插一行没有主人的额度。
 */
import type { OrgId } from "../../domain/org-id";
import { MemberNotFoundError, type TokenQuotaRepository } from "./token-quota-ports";

export interface SetMemberTokenQuotaDeps {
  readonly repo: TokenQuotaRepository;
}

export interface SetMemberTokenQuotaOutput {
  readonly userId: string;
  readonly monthlyLimit: number;
  readonly allocated: number;
  readonly unallocated: number | null;
}

export async function setMemberTokenQuota(
  deps: SetMemberTokenQuotaDeps,
  input: {
    readonly orgId: OrgId;
    readonly userId: string;
    readonly monthlyLimit: number;
    readonly actorUserId: string;
  },
): Promise<SetMemberTokenQuotaOutput> {
  if (!(await deps.repo.isOrgMember(input.orgId, input.userId))) throw new MemberNotFoundError();

  const { allocated, orgBudget } = await deps.repo.setMemberQuota(input.orgId, {
    userId: input.userId,
    monthlyLimit: input.monthlyLimit,
    updatedBy: input.actorUserId,
  });

  return {
    userId: input.userId,
    monthlyLimit: input.monthlyLimit,
    allocated,
    unallocated: orgBudget === null ? null : orgBudget - allocated,
  };
}

export interface SetOrgTokenBudgetOutput {
  readonly orgBudget: number;
  readonly allocated: number;
  readonly unallocated: number;
}

export async function setOrgTokenBudget(
  deps: SetMemberTokenQuotaDeps,
  input: { readonly orgId: OrgId; readonly monthlyBudget: number; readonly actorUserId: string },
): Promise<SetOrgTokenBudgetOutput> {
  const { allocated } = await deps.repo.setOrgBudget(input.orgId, {
    monthlyBudget: input.monthlyBudget,
    updatedBy: input.actorUserId,
  });
  return {
    orgBudget: input.monthlyBudget,
    allocated,
    unallocated: input.monthlyBudget - allocated,
  };
}
