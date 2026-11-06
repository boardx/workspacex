import type {MemberCreditQuotaSnapshot} from '@repo/contracts/member-credit-quota';
import type {OrgId} from '../../domain/org-id';
export interface MemberCreditQuotaRepository {
 readCreditQuotas(orgId:OrgId):Promise<MemberCreditQuotaSnapshot>;
 setCreditQuota(orgId:OrgId,userId:string,monthlyLimit:number,updatedBy:string):Promise<{monthlyLimit:number}>;
}

export class EnterpriseCreditPlanRequired extends Error {}
