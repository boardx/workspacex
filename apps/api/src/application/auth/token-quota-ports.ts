/**
 * F160 / F161 —— token 额度与用量的读写端口。
 *
 * ## 为什么额度与用量在同一个端口里
 *
 * 「成员配额」那一屏的每一行都要同时回答两件事：**分了多少**（`member_token_quota`）
 * 与**用了多少**（`token_usage_events` 的本月聚合）。拆成两个仓储会让 controller
 * 拿着两份按 userId 对齐的列表自己做 join——那正是「同一屏的数据在两处各查一半、
 * 迟早对不上」的开头。读侧一次给全，写侧只动额度表。
 *
 * ⚠ **本端口不写 `token_usage_events`**。用量的唯一写入点是 `TokenUsageMeterPort`
 *   （F159），这里只读。两者分开正是那条「唯一写入点」主张的形状。
 */
import type { OrgId } from "../../domain/org-id";

/** 一位成员在「成员配额」屏上的一行：身份 + 分了多少 + 用了多少。 */
export interface MemberQuotaRow {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly orgRole: string;
  readonly teamId: string | null;
  /** null = 还没被分配额度。**不是 0**——0 是「分了 0」。 */
  readonly monthlyLimit: number | null;
  /** 本自然月已用（从计量流水聚合）。没有任何调用时是真的 0。 */
  readonly usedTokens: number;
}

export interface OrgQuotaSnapshot {
  /** null = 组织额度未设置 ⇒ 不限额、不阻断（delta §1.2，等人类签）。 */
  readonly orgBudget: number | null;
  /** 逐人已分配之和。 */
  readonly allocated: number;
  /** 全组织本自然月已用。 */
  readonly orgUsed: number;
  readonly members: readonly MemberQuotaRow[];
}

export interface TokenQuotaRepository {
  /** 读整屏：组织额度 + 逐人额度 + 逐人本月已用，一次给全。 */
  readSnapshot(orgId: OrgId): Promise<OrgQuotaSnapshot>;

  /**
   * 设某人的月度额度。**在同一个事务里**先锁住本组织的额度行再校验 I-Q1
   * （逐人之和 ≤ 组织额度），否则两个管理员同时提额可以双双通过、合计超发。
   * 违反时抛 `QuotaOverallocatedError`，且**不写入**。
   */
  setMemberQuota(
    orgId: OrgId,
    input: { readonly userId: string; readonly monthlyLimit: number; readonly updatedBy: string },
  ): Promise<{ readonly allocated: number; readonly orgBudget: number | null }>;

  /**
   * 设组织月度额度。调低到低于已分配之和时抛 `BudgetBelowAllocatedError` 并不写入——
   * 不静默截断谁的额度，那是管理员要亲自做的决定。
   */
  setOrgBudget(
    orgId: OrgId,
    input: { readonly monthlyBudget: number; readonly updatedBy: string },
  ): Promise<{ readonly allocated: number }>;

  /** 这个 userId 是不是本组织成员。设额度前判一次——给一个外人设额度应当是错误而不是插一行。 */
  isOrgMember(orgId: OrgId, userId: string): Promise<boolean>;
}

/** ⚠ `remainingTokens` 是响应体的必填部分（O-29⑤：阻断必须伴随可执行的下一步）。 */
export class QuotaOverallocatedError extends Error {
  constructor(readonly remainingTokens: number) {
    super("QUOTA_OVERALLOCATED");
    this.name = "QuotaOverallocatedError";
  }
}

export class BudgetBelowAllocatedError extends Error {
  constructor(readonly allocated: number) {
    super("BUDGET_BELOW_ALLOCATED");
    this.name = "BudgetBelowAllocatedError";
  }
}

export class MemberNotFoundError extends Error {
  constructor() {
    super("MEMBER_NOT_FOUND");
    this.name = "MemberNotFoundError";
  }
}

export const TOKEN_QUOTA_REPOSITORY = Symbol("TokenQuotaRepository");
