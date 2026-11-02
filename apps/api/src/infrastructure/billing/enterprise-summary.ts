import {TeamEntitlement} from "@repo/contracts/billing-team";
import type {TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
import {assertNoPaidTeam} from "./enterprise-no-paid-team";
import {creditPeriodSnapshot} from "./pg-credit-periods";
import {EnterpriseError} from "../../application/billing/enterprise-ports";
/** Actual read model for the no-paid-Team lane; never invent subscription facts. */
export async function enterpriseSummary(s:TenantSession,orgId:OrgId,planVersion:number,memberCount:number,plan:"ordinary"|"enterprise"){
 await requireActivePricingEpoch(s);await assertNoPaidTeam(s,orgId);
 const now=(await s.query<{at:Date}>("SELECT now() AS at")).rows[0]!.at.toISOString();
 const row=(await s.query<{wallet_id:string;balance:string;total_purchased:string;total_granted:string;updated_at:Date}>("SELECT wallet_id,balance::text,total_purchased::text,total_granted::text,updated_at FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[orgId])).rows[0];
 if(row){const periods=await creditPeriodSnapshot(s,row.wallet_id);if(periods.hundredths!==0n||periods.welcomeHundredths!==0n)throw new EnterpriseError("dependency_unavailable");}
 const balance=Number(row?.balance??"0");
 return TeamEntitlement.parse({orgId,generation,planVersion,asOf:now,licenseStatus:plan==="enterprise"?"enterprise":"none",memberCount,teamPayment:null,creditGrant:{status:"none",grant:null},wallet:{ownerType:"team",ownerId:orgId,balance,permanentBalance:balance,subscriptionCredits:0,subscriptionExpiresAt:null,totalPurchased:Number(row?.total_purchased??0),totalGranted:Number(row?.total_granted??0),updatedAt:row?.updated_at.toISOString()??now},checkoutPending:false,paymentReviewRequired:false});
}
