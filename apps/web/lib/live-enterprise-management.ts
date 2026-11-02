import {EnterpriseCreditGrantRequest,EnterpriseCreditGrantResult,EnterpriseUpgradeRequest,EnterpriseUpgradeOperation} from "@repo/contracts/billing-team";
import {apiRequest} from "./api-client";
const base=(orgId:string)=>`/platform/organizations/${encodeURIComponent(orgId)}/billing`;
export const grantEnterpriseCredits=(orgId:string,input:EnterpriseCreditGrantRequest)=>apiRequest<unknown>(`${base(orgId)}/credit-grants`,{method:"POST",body:EnterpriseCreditGrantRequest.parse(input)}).then(value=>EnterpriseCreditGrantResult.parse(value));
export const upgradeEnterprise=(orgId:string,input:EnterpriseUpgradeRequest)=>apiRequest<unknown>(`${base(orgId)}/enterprise-upgrades`,{method:"POST",body:EnterpriseUpgradeRequest.parse(input)}).then(value=>EnterpriseUpgradeOperation.parse(value));
export const enterpriseOperation=(orgId:string,ref:string)=>apiRequest<unknown>(`${base(orgId)}/operations/${encodeURIComponent(ref)}`).then(value=>EnterpriseUpgradeOperation.parse(value));
