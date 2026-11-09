import {z} from 'zod';
/** A monthly spending cap, never a wallet grant. Overrides persist between UTC calendar months. */
export const DEFAULT_MEMBER_MONTHLY_CREDITS=5000;
export const MemberMonthlyCreditLimit=z.number().int().min(0).max(2147483647);
export const SetMemberCreditQuota=z.object({monthlyLimit:MemberMonthlyCreditLimit}).strict();
export const MemberCreditQuotaSnapshot=z.object({
 enterprise:z.boolean(),defaultMonthlyLimit:MemberMonthlyCreditLimit,month:z.string(),
 members:z.array(z.object({userId:z.string(),displayName:z.string(),email:z.string(),monthlyLimit:MemberMonthlyCreditLimit,
  overridden:z.boolean(),usedCredits:z.number().nonnegative(),heldCredits:z.number().nonnegative()})),
});
export type MemberCreditQuotaSnapshot=z.infer<typeof MemberCreditQuotaSnapshot>;
export const operations={
 get:{method:'GET',path:'/organizations/:orgId/credit-quotas',in:z.object({orgId:z.string().min(1)}).strict(),out:MemberCreditQuotaSnapshot},
 set:{method:'PATCH',path:'/organizations/:orgId/credit-quotas/:userId',in:SetMemberCreditQuota,out:z.object({monthlyLimit:MemberMonthlyCreditLimit})},
} as const;

export const memberCreditQuotaOperations=operations;
