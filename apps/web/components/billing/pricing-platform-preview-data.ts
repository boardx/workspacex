/** Controlled platform fixtures. These functions never call or mutate the platform API. */
import type {z} from "zod";
import {OrganizationRow} from "@repo/contracts/platform-organizations";
import {TeamEntitlement,EnterpriseUpgradeRequest,EnterpriseUpgradeOperation,EnterprisePrepaidTeamPolicy} from "@repo/contracts/billing-team";
import {previewTeamEntitlement} from "./pricing-preview-data";
type PlatformPreviewRow=z.infer<typeof OrganizationRow> & {billingSummary:TeamEntitlement};
function parseRow(value:unknown):PlatformPreviewRow{
 const row=OrganizationRow.parse(value);
 if(!row.billingSummary)throw Error("preview_billing_summary_required");
 return {...row,billingSummary:row.billingSummary};
}
export function previewPlatformTeams():PlatformPreviewRow[]{
 const facts=previewTeamEntitlement("cn","year",false);
 return [
  {orgId:"studio",name:"山海设计工作室",members:4,enterprise:false,credits:64000},
  {orgId:"research",name:"远见研究团队",members:12,enterprise:true,credits:238500},
  {orgId:"product",name:"星河产品团队",members:5,enterprise:false,credits:18500},
 ].map(seed=>parseRow({orgId:seed.orgId,name:seed.name,kind:"organization",memberCount:seed.members,
  plan:{plan:seed.enterprise?"enterprise":"ordinary",version:facts.planVersion,updatedAt:facts.asOf,updatedBy:"preview-operator",enforcement:"active",billingGeneration:facts.generation},
  billingSummary:{...facts,orgId:seed.orgId,memberCount:seed.members,licenseStatus:seed.enterprise?"enterprise":"active",
   teamPayment:seed.enterprise?null:facts.teamPayment,
   creditGrant:seed.enterprise?{status:"none",grant:null}:{...facts.creditGrant,grant:{...facts.creditGrant.grant,remainingCredits:seed.credits}},
   wallet:{...facts.wallet,ownerId:seed.orgId,balance:seed.credits,permanentBalance:seed.enterprise?seed.credits:0,
    subscriptionCredits:seed.enterprise?0:seed.credits,subscriptionExpiresAt:seed.enterprise?null:facts.wallet.subscriptionExpiresAt,
    totalPurchased:0,totalGranted:seed.enterprise?seed.credits:100000}},
 }));
}
export function previewEnterpriseUpgrade(before:PlatformPreviewRow,key:string){
 const input=EnterpriseUpgradeRequest.parse({expectedPlanVersion:before.plan.version,idempotencyKey:key});
 const facts=before.billingSummary,appliedAt=new Date(Date.parse(facts.asOf)+1000).toISOString();
 const payment=facts.teamPayment;
 const retained=payment?.provider==="stripe"&&payment.subscriptionStatus!=="canceled"&&payment.subscriptionStatus!=="incomplete_expired"?{...payment,cancelAtPeriodEnd:true}:payment;
 const plan={...before.plan,plan:"enterprise",version:input.expectedPlanVersion+1,updatedAt:appliedAt,updatedBy:"preview-operator",enforcement:"active",billingGeneration:facts.generation};
 const operation=EnterpriseUpgradeOperation.parse({orgId:before.orgId,generation:facts.generation,operationRef:`preview-operation:${key}`,
  expectedPlanVersion:input.expectedPlanVersion,createdAt:facts.asOf,asOf:appliedAt,status:"succeeded",code:null,nextAction:null,
  receipt:{auditRef:`preview-audit:${key}`,actorId:"preview-operator",appliedAt,plan,prepaidTeamPolicy:EnterprisePrepaidTeamPolicy.value,retainedTeamPayment:retained}});
 if(operation.status!=="succeeded")throw Error("preview_upgrade_receipt_required");
 const row=parseRow({...before,plan:operation.receipt.plan,billingSummary:{...facts,planVersion:operation.receipt.plan.version,
  asOf:operation.asOf,licenseStatus:"enterprise",teamPayment:operation.receipt.retainedTeamPayment}});
 return {row,operation};
}
export function previewPlatformCreditGrant(before:PlatformPreviewRow,credits:number,createdAt:string){
 const facts=before.billingSummary,wallet=facts.wallet;
 return parseRow({...before,billingSummary:{...facts,asOf:createdAt,wallet:{...wallet,balance:wallet.balance+credits,
  permanentBalance:wallet.permanentBalance+credits,totalGranted:wallet.totalGranted+credits,updatedAt:createdAt}}});
}

export function previewEnterpriseUpgradePending(before:PlatformPreviewRow,key:string,status:"processing"|"needs_review"){
 const input=EnterpriseUpgradeRequest.parse({expectedPlanVersion:before.plan.version,idempotencyKey:key});
 return EnterpriseUpgradeOperation.parse({orgId:before.orgId,generation:before.billingSummary.generation,
  operationRef:`preview-operation:${key}`,expectedPlanVersion:input.expectedPlanVersion,
  createdAt:before.billingSummary.asOf,asOf:before.billingSummary.asOf,status,receipt:null,
  code:status==="processing"?"dependency_unavailable":"payment_review_required",
  nextAction:status==="processing"?"retry_original":"contact_platform"});
}
