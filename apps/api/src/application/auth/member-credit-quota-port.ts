import type {BatchMemberCreditQuota,MemberCreditQuotaSnapshot} from '@repo/contracts/member-credit-quota';
import type {OrgId} from '../../domain/org-id';
export interface MemberCreditQuotaRepository {
 setCreditQuotas(orgId:OrgId,updates:BatchMemberCreditQuota["updates"],updatedBy:string):Promise<{updated:number}>;
 readCreditQuotas(orgId:OrgId):Promise<MemberCreditQuotaSnapshot>;
 setCreditQuota(orgId:OrgId,userId:string,monthlyLimit:number,updatedBy:string):Promise<{monthlyLimit:number}>;
}

export class EnterpriseCreditPlanRequired extends Error {}
export class MemberCreditQuotaBelowUsage extends Error {}
