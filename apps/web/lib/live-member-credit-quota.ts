import {memberCreditQuotaOperations as C,type MemberCreditQuotaSnapshot} from '@repo/contracts/member-credit-quota';
import {apiRequest} from './api-client';
const path=(template:string,orgId:string,userId?:string)=>template.replace(':orgId',encodeURIComponent(orgId)).replace(':userId',encodeURIComponent(userId??''));
export async function getMemberCreditQuotas(orgId:string):Promise<MemberCreditQuotaSnapshot>{
 return apiRequest<MemberCreditQuotaSnapshot>(path(C.get.path,orgId),{method:'GET'});
}
export async function setMemberCreditQuota(orgId:string,userId:string,monthlyLimit:number){
 return apiRequest<{monthlyLimit:number}>(path(C.set.path,orgId,userId),{method:'PATCH',body:{monthlyLimit}});
}
