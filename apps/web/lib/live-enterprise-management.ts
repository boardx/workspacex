import {operations as C,type EnterpriseCreditGrantRequest,type EnterpriseUpgradeRequest} from "@repo/contracts/billing-team";
import {apiRequest} from "./api-client";
const path=(template:string,orgId:string)=>template.replace(":orgId",encodeURIComponent(orgId));
export const grantEnterpriseCredits=(orgId:string,input:EnterpriseCreditGrantRequest)=>apiRequest<unknown>(path(C.grantEnterpriseCredits.path,orgId),{method:C.grantEnterpriseCredits.method,body:C.grantEnterpriseCredits.in.parse(input)}).then(value=>C.grantEnterpriseCredits.out.parse(value));
export const upgradeEnterprise=(orgId:string,input:EnterpriseUpgradeRequest)=>apiRequest<unknown>(path(C.createEnterpriseUpgrade.path,orgId),{method:C.createEnterpriseUpgrade.method,body:C.createEnterpriseUpgrade.in.parse(input)}).then(value=>C.createEnterpriseUpgrade.out.parse(value));
export const enterpriseOperation=(orgId:string,ref:string)=>apiRequest<unknown>(path(C.getEnterpriseUpgradeOperation.path,orgId).replace(":operationRef",encodeURIComponent(ref))).then(value=>C.getEnterpriseUpgradeOperation.out.parse(value));
