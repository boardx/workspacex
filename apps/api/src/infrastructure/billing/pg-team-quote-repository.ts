import {randomUUID} from "node:crypto";
import {TeamPaidTerm,TeamQuoteRequest,type TeamCatalog} from "@repo/contracts/billing-team";
import type {DatabasePort} from "../../application/ports/database.port";
import type {Principal} from "../../domain/principal";
import {buildTeamQuote} from "../../domain/billing/team-purchase";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {TeamBillingAccess} from "../../application/billing/team-billing-access";
import {lockOrganizationCapacity} from "../org-capacity/pg-commercial-capacity";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
import {readProductConfiguration} from "./product-catalog-configuration";
import {teamConfiguredProducts} from "./team-product-configuration";
export class PgTeamQuoteRepository{
 constructor(private readonly db:DatabasePort,private readonly access:TeamBillingAccess,private readonly salesEnabled:()=>boolean=()=>false,private readonly clock:()=>Date=()=>new Date(),private readonly market:()=>TeamCatalog["market"]|null=()=>null){}
 async create(principal:Principal,target:string,input:unknown){
  const orgId=await this.access.authorize(principal,target),request=TeamQuoteRequest.parse(input);
  const market=this.market();
  if(market!=="cn")throw Error("payment_provider_not_configured");
  return this.db.withTenant(orgId,async s=>{
   await lockOrganizationCapacity(s,orgId);await requireActivePricingEpoch(s);
   if(!(await s.query<{writable:boolean}>("SELECT kernel_org_is_writable($1) AS writable",[orgId])).rows[0]?.writable)throw Error("forbidden");
   if(!this.salesEnabled())throw Error("dependency_unavailable");
   const member=(await s.query<{org_role:string}>("SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE",[orgId,principal.userId])).rows[0];
   if(member?.org_role!=="admin")throw Error("forbidden");
   const org=(await s.query<{kind:string}>("SELECT kind FROM organizations WHERE id=$1",[orgId])).rows[0];
   if(org?.kind!=="organization")throw Error("forbidden");
   const configured=await readProductConfiguration(s,market);
   const product=teamConfiguredProducts(configured.rows).find(p=>p.sku===request.sku);
   if(!product)throw Error("product_unavailable");
   const plan=(await s.query<{plan:string;version:number}>("SELECT plan,version FROM organization_plans WHERE org_id=$1",[orgId])).rows[0];
   const license=(await s.query<{purchased_seats:string|null;pending_purchase_ref:string|null;generation:string}>("SELECT generation,purchased_seats::text,pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1",[orgId])).rows[0];
   if(license&&license.generation!==generation)throw Error("dependency_unavailable");
   if(request.purpose!=="credit_topup"&&license?.pending_purchase_ref)throw Error("commercial_change_pending");
   const count=(await s.query<{n:string}>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id=$1",[orgId])).rows[0];
   if(!count||BigInt(count.n)>BigInt(Number.MAX_SAFE_INTEGER))throw Error("dependency_unavailable");
   const terms=(await s.query<{paid_term:unknown}>("SELECT paid_term FROM billing_team_terms WHERE org_id=$1 AND generation=$2",[orgId,generation])).rows.map(t=>TeamPaidTerm.parse(t.paid_term));
   const latest=terms.sort((a,b)=>Date.parse(b.paidPeriodEnd)-Date.parse(a.paidPeriodEnd))[0];
   const quote=buildTeamQuote(request,product,{orgId,generation,quoteRef:`tq-${randomUUID()}`,catalogVersion:configured.version,now:this.clock(),memberCount:Number(count.n),planVersion:plan?.version??0,plan:plan?.plan??"ordinary",existingSeats:license?.purchased_seats===null||!license?null:Number(license.purchased_seats),existingPaidUntil:latest?new Date(latest.paidPeriodEnd):null});
   await s.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[quote.quoteRef,orgId,generation,JSON.stringify(quote),quote.createdAt,quote.expiresAt]);
   return quote;
  });
 }
}
