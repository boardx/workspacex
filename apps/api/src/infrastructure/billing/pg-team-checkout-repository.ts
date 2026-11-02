import {randomBytes} from "node:crypto";
import {TeamQuote,TeamPurchaseOutcome,TeamPurchaseFulfillment,TeamPaidTerm,type TeamCheckoutRequest} from "@repo/contracts/billing-team";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {Principal} from "../../domain/principal";
import {toOrgId} from "../../domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import type {TeamCheckoutRepository,StoredTeamPurchase} from "../../application/billing/team-checkout-ports";
import type {TeamCheckoutBinding} from "../../application/billing/team-payment-provider.port";
import {TeamBillingAccess} from "../../application/billing/team-billing-access";
import {lockOrganizationCapacity} from "../org-capacity/pg-commercial-capacity";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
export type TeamPurchaseRow={purchase_ref:string;org_id:string;generation:string;quote:unknown;created_at:Date;checkout_expires_at:Date;session_ref:string|null;payment_url:string|null;expires_at:Date|null;fulfilled_at:Date|null;closed_at:Date|null;payment_review_required:boolean;fulfillment:unknown};
export function teamPurchaseView(row:TeamPurchaseRow):StoredTeamPurchase{
 if(row.generation!==generation)throw Error("dependency_unavailable");
 const quote=TeamQuote.parse(row.quote);
 if(quote.orgId!==row.org_id||quote.generation!==row.generation)throw Error("payment_review_required");
 return {purchaseRef:row.purchase_ref,quote,createdAt:row.created_at,checkoutExpiresAt:row.checkout_expires_at,terminal:!!(row.fulfilled_at||row.closed_at||row.payment_review_required),binding:row.session_ref&&row.payment_url&&row.expires_at?{sessionRef:row.session_ref,url:row.payment_url,expiresAt:row.expires_at}:null};
}
/** Tenant-bound purchase reads; caller authenticates target membership before find/result. */
export class PgTeamCheckoutRepository implements TeamCheckoutRepository{
 constructor(private readonly db:DatabasePort,private readonly access:TeamBillingAccess,private readonly salesEnabled:()=>boolean=()=>false,private readonly clock:()=>Date=()=>new Date()){}
 authorize(principal:Principal,orgId:string){return this.access.authorize(principal,orgId).then(()=>{});}
 async find(orgId:string,key:string){return this.db.withTenant(toOrgId(orgId),async s=>{
  await requireActivePricingEpoch(s);
  const row=(await s.query<TeamPurchaseRow>("SELECT * FROM billing_team_purchases WHERE org_id=$1 AND generation=$2 AND idempotency_key=$3",[orgId,generation,key])).rows[0];
  return row?teamPurchaseView(row):null;
 });}
 async reserve(principal:Principal,orgId:string,request:TeamCheckoutRequest){return this.db.withTenant(toOrgId(orgId),async s=>{
  await lockOrganizationCapacity(s,orgId);await requireActivePricingEpoch(s);
  const member=(await s.query<{org_role:string}>("SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE",[orgId,principal.userId])).rows[0];
  if(member?.org_role!=="admin")throw Error("forbidden");
  const existing=(await s.query<TeamPurchaseRow>("SELECT * FROM billing_team_purchases WHERE org_id=$1 AND generation=$2 AND idempotency_key=$3",[orgId,generation,request.idempotencyKey])).rows[0];
  if(existing){const p=teamPurchaseView(existing);if(p.quote.quoteRef!==request.quoteRef)throw Error("idempotency_conflict");return p;}
  if(!(await s.query<{writable:boolean}>("SELECT kernel_org_is_writable($1) AS writable",[orgId])).rows[0]?.writable)throw Error("forbidden");
  if(!this.salesEnabled())throw Error("dependency_unavailable");
  const q=(await s.query<{quote:unknown}>("SELECT quote FROM billing_team_quotes WHERE org_id=$1 AND generation=$2 AND quote_ref=$3",[orgId,generation,request.quoteRef])).rows[0];
  if(!q)throw Error("quote_expired");
  const quote=TeamQuote.parse(q.quote),now=this.clock();
  if(quote.orgId!==orgId||quote.generation!==generation||Date.parse(quote.expiresAt)<=now.getTime())throw Error("quote_expired");
  if(quote.provider!=="wechat"||quote.purpose==="add_seats")throw Error("unsupported_plan_transition");
  const plan=(await s.query<{plan:string;version:number}>("SELECT plan,version FROM organization_plans WHERE org_id=$1 FOR UPDATE",[orgId])).rows[0];
  if(plan?.plan==="enterprise")throw Error("unsupported_plan_transition");
  const purchaseRef=`bt${now.toISOString().replace(/\D/g,"").slice(0,14)}${randomBytes(6).toString("hex")}`;
  if(quote.purpose!=="credit_topup"){
   if(quote.planVersion!==(plan?.version??0))throw Error("PLAN_VERSION_CONFLICT");
   const count=(await s.query<{n:string}>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id=$1",[orgId])).rows[0];
   const license=(await s.query<{purchased_seats:string|null;pending_purchase_ref:string|null;generation:string}>("SELECT purchased_seats::text,pending_purchase_ref,generation FROM org_commercial_licenses WHERE org_id=$1 FOR UPDATE",[orgId])).rows[0];
   if(license&&license.generation!==generation)throw Error("dependency_unavailable");
   if(license?.pending_purchase_ref)throw Error("commercial_change_pending");
   if(!count||BigInt(count.n)>BigInt(quote.seats)||license?.purchased_seats&&BigInt(license.purchased_seats)>BigInt(quote.seats))throw Error("capacity_insufficient");
   if(quote.purpose==="initial"&&license?.purchased_seats||quote.purpose==="renewal"&&!license?.purchased_seats)throw Error("unsupported_plan_transition");
   const terms=(await s.query<{paid_term:unknown}>("SELECT paid_term FROM billing_team_terms WHERE org_id=$1 AND generation=$2",[orgId,generation])).rows.map(t=>TeamPaidTerm.parse(t.paid_term));
   if(license?.purchased_seats&&!terms.length)throw Error("dependency_unavailable");
   if(terms.some(t=>Date.parse(t.paidPeriodEnd)>now.getTime()))throw Error("already_subscribed");
   await s.query("INSERT INTO org_commercial_licenses(org_id,generation,pending_seats,pending_purchase_ref) VALUES($1,$2,$3,$4) ON CONFLICT(org_id) DO UPDATE SET pending_seats=$3,pending_purchase_ref=$4,updated_at=now()",[orgId,generation,quote.seats,purchaseRef]);
  }
  const row=(await s.query<TeamPurchaseRow>("INSERT INTO billing_team_purchases(purchase_ref,org_id,generation,idempotency_key,quote_ref,quote,created_by,created_at,checkout_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[purchaseRef,orgId,generation,request.idempotencyKey,quote.quoteRef,JSON.stringify(quote),principal.userId,now,new Date(now.getTime()+900000)])).rows[0];
  if(!row)throw Error("dependency_unavailable");return teamPurchaseView(row);
 });}
 async bind(orgId:string,purchaseRef:string,binding:TeamCheckoutBinding){return this.db.withTenant(toOrgId(orgId),async s=>{
  await lockOrganizationCapacity(s,orgId);await requireActivePricingEpoch(s);
  const row=await this.row(s,orgId,purchaseRef,true),p=teamPurchaseView(row);
  if(binding.sessionRef!==purchaseRef||binding.expiresAt.getTime()!==p.checkoutExpiresAt.getTime()||!binding.url.startsWith("weixin://wxpay/"))throw Error("payment_review_required");
  if(p.binding){if(p.binding.sessionRef!==binding.sessionRef||p.binding.url!==binding.url)throw Error("idempotency_conflict");return p;}
  if(p.terminal)return p;
  const saved=(await s.query<TeamPurchaseRow>("UPDATE billing_team_purchases SET session_ref=$3,payment_url=$4,expires_at=$5 WHERE org_id=$1 AND purchase_ref=$2 RETURNING *",[orgId,purchaseRef,binding.sessionRef,binding.url,binding.expiresAt])).rows[0];
  if(!saved)throw Error("dependency_unavailable");return teamPurchaseView(saved);
 });}
 async result(orgId:string,purchaseRef:string){return this.db.withTenant(toOrgId(orgId),async s=>{
  await requireActivePricingEpoch(s);const row=await this.row(s,orgId,purchaseRef),p=teamPurchaseView(row);
  const receipt=(await s.query<{paid_at:Date}>("SELECT paid_at FROM billing_team_receipts WHERE org_id=$1 AND purchase_ref=$2 ORDER BY verified_at LIMIT 1",[orgId,purchaseRef])).rows[0];
  const status=row.payment_review_required?"FAILED":row.fulfilled_at?"SUCCESS":row.closed_at?"CLOSED":"PENDING";
  if(status==="PENDING"&&!p.binding)throw Error("dependency_unavailable");
  return TeamPurchaseOutcome.parse({purchaseRef,quote:p.quote,status,createdAt:p.createdAt.toISOString(),asOf:this.clock().toISOString(),paymentPage:p.binding?{url:p.binding.url,expiresAt:p.binding.expiresAt.toISOString()}:null,paidAt:receipt?.paid_at.toISOString()??null,fulfillment:row.fulfillment?TeamPurchaseFulfillment.parse(row.fulfillment):null});
 });}
 private async row(s:TenantSession,orgId:string,reference:string,lock=false){
  const row=(await s.query<TeamPurchaseRow>(`SELECT * FROM billing_team_purchases WHERE org_id=$1 AND generation=$2 AND purchase_ref=$3${lock?" FOR UPDATE":""}`,[orgId,generation,reference])).rows[0];
  if(!row)throw Error("order_not_found");return row;
 }
}
