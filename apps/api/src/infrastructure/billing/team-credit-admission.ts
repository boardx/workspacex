import type {TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {resolveTeamAiLicense} from "../../domain/billing/team-ai-license";
import {lockOrganizationCapacity} from "../org-capacity/pg-commercial-capacity";
import {pricingEpochMode} from "./personal-pricing-epoch";
import {grantDueTeamTerms} from "./team-credit-terms";
/** Epoch -> organization -> canonical license facts -> wallet; caller decides only after immutable replay check. */
export async function prepareTeamCreditAdmission(s:TenantSession,orgId:OrgId,at:Date){
 await lockOrganizationCapacity(s,orgId);
 if(await pricingEpochMode(s)==="legacy")return {decision:"allowed" as const,allowOverdraft:true};
 const p=(await s.query<{plan:string;billing_generation:string|null}>("SELECT plan,billing_generation FROM organization_plans WHERE org_id=$1 FOR UPDATE",[orgId])).rows[0];
 const terms=(await s.query<{paid_term:unknown}>("SELECT paid_term FROM billing_team_terms WHERE org_id=$1 AND generation=$2",[orgId,generation])).rows;
 const decision=resolveTeamAiLicense(generation,p?{plan:p.plan,billingGeneration:p.billing_generation}:null,terms.map(t=>t.paid_term),at);
 if(decision!=="unavailable")await grantDueTeamTerms(s,orgId,at);
 return {decision,allowOverdraft:decision==="allowed"&&p?.plan==="enterprise"};
}
