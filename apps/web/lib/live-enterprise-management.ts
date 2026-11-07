import {operations as C,type EnterpriseCreditGrantRequest,type EnterpriseUpgradeRequest} from "@repo/contracts/billing-team";
import {apiRequest} from "./api-client";
const path=(template:string,orgId:string)=>template.replace(":orgId",encodeURIComponent(orgId));
function mismatch():never{throw new Error("enterprise_response_mismatch");}
export async function grantEnterpriseCredits(orgId:string,input:EnterpriseCreditGrantRequest,sessionToken?:string){
 const body=C.grantEnterpriseCredits.in.parse(input);
 const out=C.grantEnterpriseCredits.out.parse(await apiRequest<unknown>(path(C.grantEnterpriseCredits.path,orgId),{method:C.grantEnterpriseCredits.method,body,sessionToken}));
 if(out.orgId!==orgId||out.credits!==body.credits)mismatch();
 return out;
}
export async function upgradeEnterprise(orgId:string,input:EnterpriseUpgradeRequest,sessionToken?:string,expectedActorId?:string){
 const body=C.createEnterpriseUpgrade.in.parse(input);
 const out=C.createEnterpriseUpgrade.out.parse(await apiRequest<unknown>(path(C.createEnterpriseUpgrade.path,orgId),{method:C.createEnterpriseUpgrade.method,body,sessionToken}));
 if(out.orgId!==orgId||out.expectedPlanVersion!==body.expectedPlanVersion||(expectedActorId!==undefined&&out.status==="succeeded"&&out.receipt.actorId!==expectedActorId))mismatch();
 return out;
}
export async function enterpriseOperation(orgId:string,ref:string,sessionToken?:string){
 const out=C.getEnterpriseUpgradeOperation.out.parse(await apiRequest<unknown>(path(C.getEnterpriseUpgradeOperation.path,orgId).replace(":operationRef",encodeURIComponent(ref)),{sessionToken}));
 if(out.orgId!==orgId||out.operationRef!==ref)mismatch();
 return out;
}
