import {memberCreditQuotaOperations as C,type BatchMemberCreditQuota,type MemberCreditQuotaSnapshot} from '@repo/contracts/member-credit-quota';
import {apiRequest} from './api-client';
const path=(template:string,orgId:string,userId?:string)=>template.replace(':orgId',encodeURIComponent(orgId)).replace(':userId',encodeURIComponent(userId??''));
export async function getMemberCreditQuotas(orgId:string):Promise<MemberCreditQuotaSnapshot>{
 return apiRequest<MemberCreditQuotaSnapshot>(path(C.get.path,orgId),{method:'GET'});
}
export async function setMemberCreditQuota(orgId:string,userId:string,monthlyLimit:number){
 return apiRequest<{monthlyLimit:number}>(path(C.set.path,orgId,userId),{method:'PATCH',body:{monthlyLimit}});
}
export async function setMemberCreditQuotas(orgId:string,updates:BatchMemberCreditQuota['updates']){
 return apiRequest<{updated:number}>(path(C.batch.path,orgId),{method:C.batch.method,body:{updates}});
}
